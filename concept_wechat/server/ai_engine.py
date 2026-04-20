import sys
import os
import json
from openai import OpenAI

# 强制使用 UTF-8 编码，防止 Windows 环境下打印中文字符乱码
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf8')

def generate_concept(keyword, count):
    # 从环境变量或直接设置读取 API KEY
    api_key = os.getenv("QWEN_API_KEY", "sk-407c4bf3a455403984815486b187a367")
    
    client = OpenAI(
        api_key=api_key,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    )

    prompt = f"""请搜索并返回【{keyword}】概念股的中国A股核心上市公司。

要求：
1. 只返回中国A股市场（上海、深圳证券交易所）的股票
2. 股票代码必须是6位数字
3. 返回四个字段：code（代码）、name（中文名称）、market（SH/SZ）、reason（选中理由，简要说明该公司与概念的关联性，不超过50字）
4. 不要输出固定数量的股票！请根据【{keyword}】板块在A股的真实相关性和容量动态决定成分股数量：如果是大题材（如半导体），请返回多只核心中军龙头和活跃标的；如果是细分小题材（如某具体材料），只返回纯度最高的核心标的。不要强凑数量，相关性高且成交活跃的优先。

返回严格的JSON格式：
{{
  "description": "此处填写该题材的简要宏观背景描述，不超过80字",
  "stocks": [
    {{"code": "600118", "name": "中国卫星", "market": "SH", "reason": "..."}}
  ]
}}"""

    completion = client.chat.completions.create(
        model="qwen3.6-plus",
        messages=[
            {"role": "system", "content": "你是专业的中国A股股票分析助手。"},
            {"role": "user", "content": [{"type": "text", "text": prompt}]},
        ],
        stream=True,
        top_p=0.8,
        temperature=0.7,
        extra_body={
            "enable_search": True,
            "enable_thinking": False,
            "thinking_budget": 4000
        }
    )

    full_content = ""
    for chunk in completion:
        if chunk.choices[0].delta.content is not None:
            full_content += chunk.choices[0].delta.content
    
    # 清洗 Markdown 的 ```json ... ``` 包裹
    clean_content = full_content.replace('```json', '').replace('```', '').strip()
    return clean_content

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)
        
    keyword = sys.argv[1]
    count = sys.argv[2]
    
    try:
        result = generate_concept(keyword, count)
        print(result)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
