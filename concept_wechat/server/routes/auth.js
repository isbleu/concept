const express = require('express');
const router = express.Router();
const { conceptDb } = require('../db');

// POST /api/auth/wxlogin
router.post('/wxlogin', async (req, res) => {
  const { code, isMock } = req.body;
  
  if (!code && !isMock) {
    return res.status(400).json({ error: 'Missing code' });
  }

  try {
    let openid = '';
    
    // 如果在普通浏览器中调试 (H5环境)，没有实际的微信登录上下文
    if (isMock) {
      openid = 'mock_openid_' + Math.floor(Math.random() * 1000000);
      console.log('🔗 使用模拟 H5 登录: ', openid);
    } else {
      // 生产环境: 向微信服务器请求 openid 和 session_key
      // const wxResponse = await axios.get(`https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${SECRET}&js_code=${code}&grant_type=authorization_code`);
      // openid = wxResponse.data.openid;
      
      // 此处暂时用假数据替代真实的微信请求交互
      openid = `wx_openid_${code}`;
    }

    // 在 SQLite 中寻找该用户
    let user = await conceptDb.findUserByOpenid(openid);
    
    // 如果是新用户，在库中创建
    if (!user) {
      user = await conceptDb.createUser(openid);
    } else {
      // 存在则更新访问时间
      await conceptDb.updateLastLogin(user.id);
      user = await conceptDb.get('SELECT * FROM users WHERE id = ?', [user.id]);
    }

    // 下发给客户端自定义的 token (出于安全不要直接返回openid)
    // 实际项目中推荐生成 JWT Token
    const jwtToken = `jwt_token_${user.id}`;

    res.json({
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        points: user.points,
        isNew: user.created_at === user.last_login
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
