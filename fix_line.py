# -*- coding: utf-8 -*-
with open('txtToWorldbook/services/mergeWorkflowService.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 找到第68行（索引67）并替换
new_line = '''        const prompt = `${template.replace('{CONTENT}', preCleanedContent)}\\n\\n【墨韵 - 强制输出要求】\\n1. 字段去重：同一字段名只出现一次，重复内容合并为一条。\\n2. 信息融合：同一字段的不同描述，全部保留不得遗漏。\\n3. 格式规范：使用 "**字段名**: 内容" 结构化格式。\\n4. 零解释：禁止输出思考过程、代码块、JSON格式，只输出整理后的正文。`;
'''

for i, line in enumerate(lines):
    if i == 67 and 'const prompt' in line:
        lines[i] = new_line
        break

with open('txtToWorldbook/services/mergeWorkflowService.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print('Fixed line 68')
