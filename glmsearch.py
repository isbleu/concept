import requests
prompt = """请搜索并返回SpaceX概念股的中国A股核心上市公司。

要求：
1. 只返回中国A股市场（上海、深圳证券交易所）的股票
2. 股票代码必须是6位数字
3. 返回四个字段：code（代码）、name（中文名称）、market（SH/SZ）、reason（选中理由，简要说明该公司与概念的关联性，不超过50字）
4. 返回5-10只该概念相关的核心股票

返回JSON格式：
{
  "stocks": [
    {"code": "300136", "name": "信维通信", "market": "SZ", "reason": "是星链卫星互联网地面终端设备中核心连接器的独家供应商"}
  ]
}"""

url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"

payload = {
    "model": "glm-4.5-flash",
    "messages": [
        {
            "role": "user",
            "content":prompt
        },
        {
            "role": "system",
            "content": "你是专业的中国A股股票分析助手。"
        },
    ],
    "stream": False,
    "temperature": 0.6,
    "thinking":{"type":"disabled"},
    "tools": [
        {
            "type": "web_search",
            "web_search": {
                "search_engine": "search_std",
                "enable": True,
                #"search_intent": "true",
                "count":10,
                "search_recency_filter":"oneMonth",
            }
        }
    ],
    "response_format": { "type": "json_object" }
}
headers = {
    "Authorization": "Bearer d4ab7bf1d159484abe1df76fc2809975.dIbXcTskJ5Jer69Z",
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)

print(response.text)