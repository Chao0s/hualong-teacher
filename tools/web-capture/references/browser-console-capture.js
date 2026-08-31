/**
 * 浏览器控制台抓取脚本（兜底用，不是默认路径）。
 *
 * 默认请用 scripts/capture.js 直接走 HTTP。只有页面内容确实由 JS 生成、
 * 且数据不在源码里时，才用这个脚本抓 JS 执行后的 DOM。
 *
 * 人工用法：
 *   1. 浏览器按 F12 打开控制台，整段贴进去回车
 *   2. 执行 copy(window.__pageExportText)
 *   3. 粘到编辑器，存成 <页面名>.txt
 *
 * 自动用法：用 chrome-devtools MCP 的 evaluate_script 跑同一段，返回值写文件。
 *   注意每页约 30 KB 会经过模型上下文，不要批量用。
 *
 * 已知噪音：会把浏览器插件注入的 DOM 和 CSS 一起抓走。建议在无痕窗口里跑。
 */
(async () => {
  console.log('開始收集 DOM、CSS 和 JavaScript……');

  const failedResources = [];

  async function readResource(url, type) {
    try {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'force-cache'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return {
        ok: true,
        content: await response.text()
      };
    } catch (error) {
      const failure = {
        type,
        url,
        error: String(error)
      };

      failedResources.push(failure);

      return {
        ok: false,
        content: '',
        error: String(error)
      };
    }
  }

  function getDoctype() {
    if (!document.doctype) {
      return '<!DOCTYPE html>';
    }

    const doctype = document.doctype;
    let result = `<!DOCTYPE ${doctype.name}`;

    if (doctype.publicId) {
      result += ` PUBLIC "${doctype.publicId}"`;
    }

    if (doctype.systemId) {
      result += ` "${doctype.systemId}"`;
    }

    return `${result}>`;
  }

  function captureRenderedDOM() {
    const clonedDocument = document.documentElement.cloneNode(true);

    const originalElements = document.querySelectorAll(
      'input, textarea, select, option, details'
    );

    const clonedElements = clonedDocument.querySelectorAll(
      'input, textarea, select, option, details'
    );

    originalElements.forEach((original, index) => {
      const clone = clonedElements[index];

      if (!clone) {
        return;
      }

      if (original instanceof HTMLInputElement) {
        clone.setAttribute('value', original.value);

        if (original.checked) {
          clone.setAttribute('checked', '');
        } else {
          clone.removeAttribute('checked');
        }
      }

      if (original instanceof HTMLTextAreaElement) {
        clone.textContent = original.value;
      }

      if (original instanceof HTMLOptionElement) {
        if (original.selected) {
          clone.setAttribute('selected', '');
        } else {
          clone.removeAttribute('selected');
        }
      }

      if (original instanceof HTMLDetailsElement) {
        if (original.open) {
          clone.setAttribute('open', '');
        } else {
          clone.removeAttribute('open');
        }
      }
    });

    return `${getDoctype()}\n${clonedDocument.outerHTML}`;
  }

  async function collectCSS() {
    const styles = [];

    document.querySelectorAll('style').forEach((styleElement, index) => {
      styles.push({
        type: 'inline',
        index: index + 1,
        media: styleElement.media || '',
        content: styleElement.textContent || ''
      });
    });

    const stylesheetLinks = [
      ...document.querySelectorAll('link[rel~="stylesheet"][href]')
    ];

    for (const link of stylesheetLinks) {
      const url = link.href;

      console.log(`正在讀取 CSS：${url}`);

      const result = await readResource(url, 'css');

      styles.push({
        type: 'external',
        url,
        media: link.media || '',
        disabled: link.disabled,
        loaded: result.ok,
        error: result.error || null,
        content: result.content
      });
    }

    // 收集 constructable/adopted stylesheets
    if (Array.isArray(document.adoptedStyleSheets)) {
      document.adoptedStyleSheets.forEach((stylesheet, index) => {
        try {
          const content = [...stylesheet.cssRules]
            .map(rule => rule.cssText)
            .join('\n');

          styles.push({
            type: 'adopted',
            index: index + 1,
            content
          });
        } catch (error) {
          failedResources.push({
            type: 'adopted-css',
            index: index + 1,
            error: String(error)
          });
        }
      });
    }

    return styles;
  }

  async function collectJavaScript() {
    const scripts = [];
    const scriptElements = [...document.scripts];

    for (const [index, scriptElement] of scriptElements.entries()) {
      if (scriptElement.src) {
        const url = scriptElement.src;

        console.log(`正在讀取 JavaScript：${url}`);

        const result = await readResource(url, 'javascript');

        scripts.push({
          type: 'external',
          index: index + 1,
          url,
          scriptType: scriptElement.type || 'text/javascript',
          async: scriptElement.async,
          defer: scriptElement.defer,
          noModule: scriptElement.noModule,
          integrity: scriptElement.integrity || '',
          crossOrigin: scriptElement.crossOrigin || '',
          loaded: result.ok,
          error: result.error || null,
          content: result.content
        });
      } else {
        const content = scriptElement.textContent || '';

        if (content.trim()) {
          scripts.push({
            type: 'inline',
            index: index + 1,
            scriptType: scriptElement.type || 'text/javascript',
            content
          });
        }
      }
    }

    return scripts;
  }

  function collectResourceURLs() {
    const resources = performance
      .getEntriesByType('resource')
      .map(resource => ({
        url: resource.name,
        initiatorType: resource.initiatorType,
        duration: resource.duration,
        transferSize: resource.transferSize,
        encodedBodySize: resource.encodedBodySize,
        decodedBodySize: resource.decodedBodySize
      }));

    return resources;
  }

  function collectEnvironment() {
    return {
      exportedAt: new Date().toISOString(),

      page: {
        url: location.href,
        origin: location.origin,
        title: document.title,
        referrer: document.referrer,
        readyState: document.readyState,
        characterSet: document.characterSet,
        compatibilityMode: document.compatMode
      },

      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        devicePixelRatio: window.devicePixelRatio,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      },

      screen: {
        width: screen.width,
        height: screen.height,
        availableWidth: screen.availWidth,
        availableHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth
      },

      browser: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        languages: navigator.languages,
        platform: navigator.platform,
        cookieEnabled: navigator.cookieEnabled,
        online: navigator.onLine
      },

      mediaQueries: {
        darkMode: matchMedia('(prefers-color-scheme: dark)').matches,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        portrait: matchMedia('(orientation: portrait)').matches,
        coarsePointer: matchMedia('(pointer: coarse)').matches
      },

      iframe: {
        isInsideIframe: window.self !== window.top
      }
    };
  }

  try {
    const renderedDOM = captureRenderedDOM();
    const styles = await collectCSS();
    const scripts = await collectJavaScript();
    const resources = collectResourceURLs();
    const environment = collectEnvironment();

    const exportPackage = {
      exportFormat: 'browser-ui-debug-package',
      exportVersion: 1,

      instructionsForAI: [
        'renderedDOM 是 JavaScript 執行後的最終 DOM，不一定等於原始 HTML。',
        'styles 包含內嵌和外部 CSS。',
        'scripts 包含內嵌和可讀取的外部 JavaScript。',
        'failedResources 列出因跨域或權限問題而無法讀取的檔案。',
        '請將此網頁版本與微信小程序的 WXML、WXSS、JS 和截圖進行對比。',
        '重點檢查 display、position、box-sizing、flex、grid、overflow、字型、行高和尺寸單位。'
      ],

      environment,
      renderedDOM,
      styles,
      scripts,
      resources,
      failedResources
    };

    const exportText = JSON.stringify(exportPackage, null, 2);

    // 保存於頁面全域變數，避免剪貼簿失敗後需要重新收集
    window.__pageExportPackage = exportPackage;
    window.__pageExportText = exportText;

    let copied = false;

    // Chrome DevTools Console 提供的 copy() 函數
    try {
      if (typeof copy === 'function') {
        copy(exportText);
        copied = true;
      }
    } catch (error) {
      console.warn('DevTools copy() 無法使用：', error);
    }

    // 備用剪貼簿方法
    if (!copied && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(exportText);
        copied = true;
      } catch (error) {
        console.warn('Clipboard API 無法使用：', error);
      }
    }

    console.log('----------------------------------------');
    console.log('頁面資料收集完成');
    console.log(`DOM 大小：${renderedDOM.length.toLocaleString()} 字元`);
    console.log(`CSS 數量：${styles.length}`);
    console.log(`JavaScript 數量：${scripts.length}`);
    console.log(`失敗資源數量：${failedResources.length}`);

    if (copied) {
      console.log('✅ 已複製到剪貼簿');
      console.log('請貼到 VS Code 或記事本，保存為 page-export.json');
    } else {
      console.log('⚠️ 瀏覽器禁止自動複製');
      console.log('請另外執行以下指令：');
      console.log('copy(window.__pageExportText)');
    }

    console.log('如果內容太大，也可以在 Console 逐項複製：');
    console.log('copy(window.__pageExportPackage.renderedDOM)');
    console.log('copy(JSON.stringify(window.__pageExportPackage.styles, null, 2))');
    console.log('copy(JSON.stringify(window.__pageExportPackage.scripts, null, 2))');
    console.log('----------------------------------------');

    return exportPackage;
  } catch (error) {
    console.error('匯出失敗：', error);
    throw error;
  }
})();
