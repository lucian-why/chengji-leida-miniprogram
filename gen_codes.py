import json
import random
import string

chars = string.ascii_uppercase.replace('O','').replace('I','') + string.digits.replace('0','').replace('1','')

data = []
configs = [('M', 'month', 31), ('Q', 'quarter', 93), ('Y', 'year', 366)]

for prefix_char, card_type, duration in configs:
    for _ in range(5): # Generate 5 of each
        code = f"V{prefix_char}-{''.join(random.choices(chars, k=8))}"
        data.append({
            "code": code,
            "type": card_type,
            "durationDays": duration,
            "status": "unused",
            "usedBy": "",
            "usedTime": None
        })

with open('vip_codes.json', 'w') as f:
    json.dump(data, f, indent=2)

print("Created vip_codes.json")