/**
 * HTTP Basic Auth 认证中间件
 */
const authMiddleware = (req, res, next) => {
  // 从环境变量获取认证凭据
  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;

  // 如果未设置认证凭据，跳过认证（开发环境）
  if (!username || !password) {
    console.warn('警告：未设置AUTH_USERNAME或AUTH_PASSWORD，认证已禁用');
    return next();
  }

  // 获取请求头中的认证信息
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    // 未提供认证信息，返回401并要求认证
    res.setHeader('WWW-Authenticate', 'Basic realm="Stock Concept Management"');
    return res.status(401).json({
      success: false,
      error: '需要认证'
    });
  }

  // 验证Basic Auth
  try {
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
    const [inputUsername, inputPassword] = auth.split(':');

    if (inputUsername === username && inputPassword === password) {
      next(); // 认证成功，继续执行
    } else {
      res.setHeader('WWW-Authenticate', 'Basic realm="Stock Concept Management"');
      return res.status(401).json({
        success: false,
        error: '账号或密码错误'
      });
    }
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: '认证格式错误'
    });
  }
};

module.exports = authMiddleware;
