const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const https = require('https');

// 登录：wx.login 的 code 换 openid；若携带 phoneCode（getPhoneNumber 按钮回传）则换手机号并落库
exports.main = async (event) => {
  const { code, phoneCode } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  let phone = '';

  if (phoneCode) {
    // 用云开发 access_token 调微信接口换手机号（手机号快速验证组件返回的 code）
    const tokenRes = await cloud.getAccessToken();
    const accessToken = tokenRes.access_token;
    const apiUrl = 'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=' + accessToken;
    const resp = await new Promise((resolve, reject) => {
      const req = https.request(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
      req.on('error', reject);
      req.write(JSON.stringify({ code: phoneCode }));
      req.end();
    });
    if (resp && resp.errcode === 0 && resp.phone_info) {
      phone = resp.phone_info.phone_number;
    }
  }

  const users = db.collection('users');
  const exist = await users.where({ openid }).get();
  if (exist.data.length === 0) {
    await users.add({ data: { openid, phone, createdAt: Date.now(), unlockedAll: false } });
  } else if (phone) {
    await users.doc(exist.data[0]._id).update({ data: { phone } });
  }
  return { openid, phone };
};
