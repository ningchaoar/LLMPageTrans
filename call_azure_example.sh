curl --location --request POST 'https://aidp.bytedance.net/api/modelhub/online/v2/crawl?ak=${your_ak}' \
--header 'Content-Type: application/json' \
--data '{
    "stream": false,
    "model": "gpt-5.4-2026-03-05",
    "max_tokens": 4096,
    "reasoning": {"effort": "none"},
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "What is the result of 1+1?"
                }
            ]
        }
    ],
    "
}'