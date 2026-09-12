/** 教师评价 —— 当前班级四项真实进度。 */
const assess=require('../../services/assessment');
const guard=require('../../utils/guard');

const ROUTES = {
  monthly: '/pages/teacher-monthly-evaluation/index',
  term: '/pages/teacher-term-evaluation/index',
  comprehensive: '/pages/growth-comprehensive-assessment/index',
  message: '/pages/teacher-message/index',
};

Page({
  data: {
    entries: [
      { key: 'monthly', label: '月度评价' },
      { key: 'term', label: '学期评价' },
      { key: 'comprehensive', label: '综合评估' },
      { key: 'message', label: '教师寄语' },
    ],

    // 四列：本月评价 / 学期评估 / 综合评估 / 教师寄语
    rows: [],
    loading:true,
    error:'',
    termId:null,
    month:'',
    monthOptions:[],
    monthLabels:[],
    monthIndex:0,
    monthHeading:'本月评价',
  },

  onShow() { this.refresh(); },

  async refresh() {
    const seq=(this.loadSeq||0)+1;
    this.loadSeq=seq;
    this.setData({rows:[],loading:true,error:'',termId:null});
    try {
      await guard.requireSession();
      const board=await assess.teacherEvaluationBoard({month:this.data.month || undefined});
      if(seq!==this.loadSeq) return;
      this.setData({rows:board.rows,termId:board.termId,loading:false,
        month:board.month,monthOptions:board.monthOptions,
        monthLabels:board.monthOptions.map(m=>`${m.slice(0,4)}年${Number(m.slice(5))}月`),
        monthIndex:Math.max(0,board.monthOptions.indexOf(board.month)),
        monthHeading:`${Number(board.month.slice(5))}月评价`,
      });
    } catch(err) {
      if(seq!==this.loadSeq) return;
      if (this.data.month && err.details && err.details.rule==='month_in_current_term') {
        this.setData({month:'',monthOptions:[],monthLabels:[]});
        return this.refresh();
      }
      guard.endSessionOnAuthFailure(err);
      this.setData({loading:false,error:err.userMessage||err.message||'评价进度加载失败'});
    }
  },

  onRetry() { this.refresh(); },

  onMonthChange(e) {
    const month=this.data.monthOptions[Number(e.detail.value)];
    if (!month || month===this.data.month) return;
    this.setData({month});
    this.refresh();
  },

  onEntryTap(e) {
    const key = e.currentTarget.dataset.key;
    const url = ROUTES[key];
    if (url) {
      wx.navigateTo({ url });
      return;
    }
    const hit = this.data.entries.find((item) => item.key === key);
    wx.showToast({ title: `${hit.label}（预览工程未接入）`, icon: 'none' });
  },
});
