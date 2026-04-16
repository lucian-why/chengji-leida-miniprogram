import json
import random
import string

chars = string.ascii_uppercase.replace('O','').replace('I','') + string.digits.replace('0','').replace('1','')

types = [
    ('M', 'month', 31, 'E:/成绩雷达/月卡兑换码_31天.txt'),
    ('Q', 'quarter', 93, 'E:/成绩雷达/季卡兑换码_93天.txt'),
    ('Y', 'year', 366, 'E:/成绩雷达/年卡兑换码_366天.txt')
]

docs = []
for prefix, name, days, filepath in types:
    codes = []
    for _ in range(20):
        code_str = f"V{prefix}-{''.join(random.choices(chars, k=8))}"
        codes.append(code_str)
        docs.append({
            "code": code_str,
            "type": name,
            "durationDays": days,
            "status": "unused",
            "usedBy": "",
            "usedTime": None
        })
    with open(filepath, 'a', encoding='utf-8') as f:
        f.write('\n' + '\n'.join(codes))

with open('E:/成绩雷达/成绩雷达_小程序/vip_codes_new.json', 'w', encoding='utf-8') as f:
    json.dump(docs, f, ensure_ascii=False)
