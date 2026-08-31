/**
 * 党建线（7 条只读端点）打在 db/testdata 服务端上的探针。
 *
 * 加载的是未经修改的 `services/party.js` 与 `utils/*`，所以路径写错、字段改名、
 * 枚举译反都会在这里红。**只读**：不建行、不改状态，跑完数据库一个字节不变。
 *
 *   node tools/probe-party.mjs
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWxStub, scoreboard } from './lib/wx-stub.mjs';

installWxStub();

const HERE = dirname(fileURLToPath(import.meta.url));
const MP = resolve(HERE, '..', 'miniprogram');
const require_ = createRequire(import.meta.url);

const party = require_(resolve(MP, 'services', 'party.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const api = require_(resolve(MP, 'utils', 'request.js'));
const session = require_(resolve(MP, 'utils', 'session.js'));

const sb = scoreboard();
const { check, note, has } = sb;
const bound = { check: check.bind(sb), note: note.bind(sb), has: has.bind(sb) };

/**
 * 教师看得见的笔数，**不等于**表里的行数。
 *
 * STATS.md：db_party_study 5、db_party_activity 4、db_party_brand 1。
 * 教师只读得到 `s3`（已发布）：
 *   study 4  = s1 草稿      管理员还没发出来
 *   study 5  = s5 已下架    发过又撤了
 *   activity 4 = s2 待审核   还在审
 * 断言写成「看得见 3 条**且**这几个 id 不在里面」比写成「3 条」强：它同时钉住了
 * 看得见的与看不见的，改坏任何一边都会红。
 */
const TOTAL = { studies: 5, activities: 4, brands: 1 };
const EXPECTED = { studies: 3, activities: 3, brands: 1 };
const HIDDEN = { studies: [4, 5], activities: [4], brands: [] };

async function main() {
  const ctx = await guard.requireSession();
  bound.check('登录成功，角色为 teacher', ctx.role === 'teacher', `role=${ctx.role}`);

  /* ── 党建学习 ─────────────────────────────────────────────────────────── */
  const studies = await party.listStudies({ limit: 100 });
  bound.check(`学习文件看得见 ${EXPECTED.studies} 条（表里 ${TOTAL.studies} 行，只发布态可读）`,
    studies.items.length === EXPECTED.studies, `拿到 ${studies.items.length} 条`);
  bound.check(`草稿与已下架不可见（study_id ${HIDDEN.studies.join('、')}）`,
    !studies.items.some((s) => HIDDEN.studies.includes(s.id)),
    `列表里出现了 ${studies.items.map((s) => s.id).join(',')}`);
  bound.has(studies.items[0], ['id', 'title', 'type', 'department', 'date', 'meta'], '学习列表行');

  const types = new Set(studies.items.map((s) => s.type));
  bound.check('study_type 译成了中文（政策文件/学习材料/制度文件）',
    [...types].every((t) => ['政策文件', '学习材料', '制度文件'].includes(t)),
    `实际：${[...types].join(',')}`);
  bound.check('列表 meta 是「类型·日期·部门」三段',
    studies.items.every((s) => s.meta.length === 3),
    `实际：${JSON.stringify(studies.items.map((s) => s.meta))}`);
  bound.check('日期已格式化为 MM-DD，不是 ISO 串',
    studies.items.every((s) => /^\d{2}-\d{2}$/.test(s.date)),
    `实际：${studies.items.map((s) => s.date).join(',')}`);

  const study = await party.getStudy(studies.items[0].id);
  bound.has(study, ['id', 'title', 'type', 'department', 'paragraphs', 'videos', 'files'], '学习详情');
  bound.check('详情正文切成了非空段落',
    study.paragraphs.length > 0 && study.paragraphs.every((p) => p.length > 0),
    `实际 ${study.paragraphs.length} 段`);
  bound.check('主文件挂在 files 上（usage_key=main_file）',
    study.files.length === 1 && study.files[0].usageKey === 'main_file',
    `实际 ${JSON.stringify(study.files)}`);

  // video_links 可能是 null —— 三条里有一条就是。读作没有视频，不能炸。
  const withNullVideos = await party.getStudy(2);
  bound.check('video_links 为 null 时读作空数组，不抛错',
    Array.isArray(withNullVideos.videos) && withNullVideos.videos.length === 0,
    `实际 ${JSON.stringify(withNullVideos.videos)}`);

  const withVideos = await party.getStudy(1);
  bound.check('有视频时映射成 {name, url}',
    withVideos.videos.length > 0
      && Boolean(withVideos.videos[0].name) && Boolean(withVideos.videos[0].url),
    `实际 ${JSON.stringify(withVideos.videos)}`);

  /* ── 党建活动 ─────────────────────────────────────────────────────────── */
  const activities = await party.listActivities({ limit: 100 });
  bound.check(`党建活动看得见 ${EXPECTED.activities} 条（表里 ${TOTAL.activities} 行）`,
    activities.items.length === EXPECTED.activities, `拿到 ${activities.items.length} 条`);
  bound.check(`待审核的活动不可见（activity_id ${HIDDEN.activities.join('、')}）`,
    !activities.items.some((a) => HIDDEN.activities.includes(a.id)),
    `列表里出现了 ${activities.items.map((a) => a.id).join(',')}`);
  bound.has(activities.items[0], ['id', 'title', 'location', 'date', 'meta'], '活动列表行');

  const activity = await party.getActivity(activities.items[0].id);
  bound.has(activity, ['id', 'title', 'sub', 'time', 'body', 'files'], '活动详情');
  bound.check('活动副标题是「党建活动 · 地点」',
    activity.sub.startsWith('党建活动'), `实际「${activity.sub}」`);
  bound.check('活动时间精确到分（activity_at 是计划时间）',
    /^\d{2}-\d{2} \d{2}:\d{2}$/.test(activity.time), `实际「${activity.time}」`);
  bound.check('活动正文非空', activity.body.length > 0, '正文是空的');

  /* ── 品牌建设 ─────────────────────────────────────────────────────────── */
  const brands = await party.listBrands({ limit: 100 });
  bound.check(`品牌 ${EXPECTED.brands} 条`,
    brands.items.length === EXPECTED.brands, `拿到 ${brands.items.length} 条`);
  bound.has(brands.items[0], ['id', 'title', 'glyph', 'tags', 'meta'], '品牌列表卡');
  bound.check('品牌图标字取自标题首字（库里没有图标列）',
    brands.items[0].glyph === brands.items[0].title.charAt(0),
    `glyph=${brands.items[0].glyph}，title=${brands.items[0].title}`);

  const brand = await party.getBrand(brands.items[0].id);
  bound.has(brand, ['id', 'title', 'sub', 'chips', 'body'], '品牌详情');
  bound.check('品牌标签来自 brand_tag', brand.chips.length > 0,
    `实际 ${JSON.stringify(brand.chips)}`);

  /* ── 首屏聚合 ─────────────────────────────────────────────────────────── */
  const home = await party.home();
  bound.has(home, ['carousel', 'studies', 'activities', 'brands'], '首屏');
  bound.check('轮播取 3 条（不足则取实际笔数）',
    home.carousel.length === Math.min(3, EXPECTED.studies),
    `实际 ${home.carousel.length} 条`);
  bound.check('轮播就是最新的学习文件（published_at DESC 取前 3）',
    home.carousel[0].id === studies.items[0].id,
    `轮播首条 id=${home.carousel[0].id}，列表首条 id=${studies.items[0].id}`);
  bound.check('三块列表各不超过 3 条',
    home.studies.length <= 3 && home.activities.length <= 3 && home.brands.length <= 3,
    `实际 ${home.studies.length}/${home.activities.length}/${home.brands.length}`);
  bound.check('首屏的学习行带着类型与部门（/party/home 给不出这两个字段）',
    home.studies.every((s) => s.type && s.date),
    `实际 ${JSON.stringify(home.studies.map((s) => s.meta))}`);

  /* ── 服务端与契约的偏离，逐条核实后登记 ────────────────────────────────── */
  const rawHome = await api.get('/party/home');
  const contractKeys = ['carousel', 'latest_studies', 'latest_activities', 'latest_brands'];
  const missing = contractKeys.filter((k) => rawHome[k] === undefined);
  if (missing.length) {
    bound.note(
      'GET /party/home 的回包不合契约 PartyHome —— 所以 services/party.home() 改用三条列表端点拼。',
      `契约要求 ${contractKeys.join('/')}；实际回的是 ${Object.keys(rawHome).join('/')}。`
      + ` 且 studies[0] 只有 ${Object.keys(rawHome.studies[0]).join('/')}，`
      + '缺 PartyStudyCard 必填的 study_type 与 excerpt。'
    );
  }

  const rawStudy = await api.get('/party/studies/1');
  if (rawStudy.file_refs === undefined && rawStudy.files !== undefined) {
    bound.note(
      'PartyStudy 的附件键名是 files，契约写的是 file_refs。',
      '成本为零，services/party.js 的 fileRefs() 两个都读，契约的优先。'
    );
  }

  /* ── 死会话自动恢复（开发者工具里 401 白页那个 bug 的回归测试） ────────── */
  //
  // 复现的是真实场景：客户端的 token 存在 Storage 里跨重启存活，服务端的会话表
  // 是进程内存重启即失效。于是本地有票、对面不认。
  const deadToken = 'THIS_TOKEN_WAS_NEVER_ISSUED_BY_THE_SERVER';
  session.setToken(deadToken);
  bound.check('前置：本地确实存着那张死票', session.getToken() === deadToken);

  const recovered = await party.listStudies({ limit: 100 });
  bound.check('拿着死 token 也能取到数据（request 层自动重签并重放）',
    recovered.items.length === EXPECTED.studies,
    `拿到 ${recovered.items.length} 条`);
  bound.check('恢复后本地换成了一张新票',
    session.getToken() && session.getToken() !== deadToken,
    `token 仍是 ${session.getToken()}`);

  /* ── 范围与不存在 ─────────────────────────────────────────────────────── */
  let notFound = false;
  try {
    await party.getStudy(99999);
  } catch (err) {
    notFound = err.code === 'not_found';
    if (!notFound) bound.check('不存在的 study_id 应回 not_found', false, `实际 ${err.code}`);
  }
  bound.check('不存在的 study_id 回 not_found', notFound);
}

main()
  .catch((err) => {
    bound.check(`探针本身出错：${err && err.stack ? err.stack : err}`, false);
  })
  .then(() => sb.report());
