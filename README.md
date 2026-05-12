# lamps studio 灯具详情图组 Web

这是一个公开网站方向的可运行初版，覆盖：

- 手机号注册 / 手机号密码登录
- 余额显示
- 微信支付 / 支付宝真实充值订单接口
- 产品图上传
- 上传后自动识别灯具风格、材质、作用、卖点
- 自动生成灯具详情图组设计规范和完整提示词
- Nano Banana 2、Nano Banana Pro、GPT Image-2 等模型切换
- Gemini 产品识别 API 接入口
- OpenAI Images API 服务端接入口

## 运行

```powershell
npm install
npm start
```

默认地址：

```text
http://localhost:4192
```

## 部署到 Render 免费公网地址

项目已包含 `render.yaml`，服务名固定为 `lvjiaoshou`。在 Render 中用 Blueprint 连接仓库后，公网地址会是：

```text
https://lvjiaoshou.onrender.com
```

Render 会自动使用：

```text
buildCommand: npm ci
startCommand: npm start
healthCheckPath: /api/health
```

注意：Render 必须连接 GitHub/GitLab 仓库或使用 Render API 创建服务，本地文件无法直接占用 `onrender.com` 子域名。

## 接真实充值

充值按手机号账号入账：用户用手机号登录，选择金额和支付方式，扫码支付；微信或支付宝异步回调成功后，系统按 `1 元 = 10 积分` 给该手机号账号加余额。

正式可用前需要：

1. 一个公网 HTTPS 域名，填入 `PUBLIC_BASE_URL`
2. 微信支付商户号、AppID、API v3 Key、商户私钥、商户证书序列号、微信支付平台公钥
3. 支付宝 AppID、应用私钥、支付宝公钥

`.env` 示例：

```text
PUBLIC_BASE_URL=https://your-domain.example.com

WECHAT_PAY_MCHID=你的微信商户号
WECHAT_PAY_APPID=你的微信支付 AppID
WECHAT_PAY_API_V3_KEY=32字节APIv3Key
WECHAT_PAY_SERIAL_NO=商户证书序列号
WECHAT_PAY_PRIVATE_KEY_PATH=C:\secure\wechat_apiclient_key.pem
WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH=C:\secure\wechatpay_platform_public_key.pem

ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
ALIPAY_APP_ID=你的支付宝AppID
ALIPAY_PRIVATE_KEY_PATH=C:\secure\alipay_private_key.pem
ALIPAY_PUBLIC_KEY_PATH=C:\secure\alipay_public_key.pem
```

回调地址会自动使用：

```text
https://your-domain.example.com/api/payments/wechat/notify
https://your-domain.example.com/api/payments/alipay/notify
```

## 接真实 OpenAI 出图

OpenAI API Key 只在管理员后台配置，不写入 `.env`。管理员登录后进入“管理页”，填入 OpenAI API Key 并开启真实 API 出图即可。

## 接 API易 出图

API易 Key 只在管理员后台配置。默认 Base URL：

```text
https://api.apiyi.com/v1
```

开启“真实 API 出图”并勾选“优先使用 API易 出图”后，系统会通过 OpenAI 兼容的 `/images/edits` 接口调用 API易。用户只选择模型，后端自动用管理员配置的 API易 Key 出图。

## 接 Gemini 产品识别

Gemini API Key 只在管理员后台配置，不写入 `.env`。管理员可在管理页配置 Gemini Key，用于产品识别和 Gemini 图像模型出图。

## 接真实验证码

手机号验证码使用阿里云短信：在管理员后台配置 AccessKey ID、AccessKey Secret、短信签名、短信模板 Code。模板变量需要包含 `${code}`。

邮箱验证码使用 SMTP：在管理员后台配置 SMTP Host、Port、用户名、密码/授权码、From 和是否 SSL/TLS。
