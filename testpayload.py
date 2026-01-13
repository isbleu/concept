import requests

url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"

payload = {
    "model": "glm-4.5-flash",
    "messages": [
        {
            "role": "system",
            "content": "你是一个有用的AI助手。"
        },
        {
            "role": "user",
            "content": "请介绍一下人工智能的发展历程。"
        }
    ],
    "stream": False,
    "temperature": 1,
    "tools": [
        {
            "type": "web_search",
            "web_search": {
                "search_engine": "search_std",
                "enable": True,
                "search_intent": "true"
            }
        }
    ],
    "response_format": { "type": "json_object" }
}
headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)

print(response.text)