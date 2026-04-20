import websocket
import json
import threading
import time
import ssl

# ================= 配置区 =================
# 请在此处填写您在 iTick.org 申请的真实 Token
TOKEN = "a1fb69e38a754fa9ba5060d5651871f0d2150540f5644282837be6a18166feb3" 
# 订阅的股票代码格式: symbol$region (例: 平安银行$SZ, 腾讯$HK, 苹果$US)
SUBSCRIBE_SYMBOLS = "000001$SZ,AAPL$US,LITE$US"#,00700$HK
# ==========================================

# ⚠️ 关键修正：免费版地址必须包含 /stock 后缀
WS_URL = "wss://api-free.itick.org/stock"

# 状态记录
is_subscribed = False

def send_ping(ws):
    """每 30 秒发送一次心跳包"""
    while True:
        time.sleep(30)
        if ws.sock and ws.sock.connected:
            ping_msg = {
                "ac": "ping",
                "params": str(int(time.time() * 1000))
            }
            ws.send(json.dumps(ping_msg))

def on_message(ws, message):
    global is_subscribed
    data = json.loads(message)
    
    # 打印原始消息以供调试
    # print(f"📥 收到消息: {data}")

    if "msg" in data:
        print(f"📢 系统消息: {data['msg']}")
        # 仅在认证成功且尚未订阅时进行单次订阅
        if data.get("resAc") == "auth" and data.get("code") == 1 and not is_subscribed:
            subscribe_msg = {
                "ac": "subscribe",
                "params": SUBSCRIBE_SYMBOLS,
                "types": "quote,tick"
            }
            print(f"📤 [首次订阅] 目标: {SUBSCRIBE_SYMBOLS}")
            ws.send(json.dumps(subscribe_msg))
            is_subscribed = True
            
    elif data.get("code") == 1 and "data" in data:
        quote = data["data"]
        q_type = quote.get("type", quote.get("resAc")) # 兼容不同返回格式
        symbol = f"{quote.get('s')}.{quote.get('r')}"
        
        if q_type == "quote":
            print(f"📈 [行情] {symbol} | 价格: {quote.get('ld')} | 涨跌幅: {quote.get('chp')}%")
        elif q_type == "tick":
            print(f"⚡ [逐笔] {symbol} | 价格: {quote.get('ld')} | 量: {quote.get('v')}")

def on_error(ws, error):
    print(f"❌ 发生错误: {error}")

def on_close(ws, status, msg):
    global is_subscribed
    is_subscribed = False
    print(f"🔌 连接已关闭: {status} - {msg}")

def on_open(ws):
    print(f"🚀 正在连接至 {WS_URL}...")

if __name__ == "__main__":
    websocket.enableTrace(False)
    ws = websocket.WebSocketApp(
        WS_URL,
        header=[f"token: {TOKEN}"],
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close
    )

    t = threading.Thread(target=send_ping, args=(ws,))
    t.daemon = True
    t.start()

    ws.run_forever(sslopt={"cert_reqs": ssl.CERT_NONE})
