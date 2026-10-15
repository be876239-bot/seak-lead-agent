const MASK = '【已脱敏】';

const RULES: { name: string; re: RegExp }[] = [
  { name: 'idCard', re: /(?<!\d)\d{17}[\dXx](?!\w)|(?<!\d)\d{15}(?!\d)/g },
  { name: 'phone', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'labeledContact', re: /(?:微信|wechat|wx|vx)\s*(?:号|id)?\s*[:：]?\s*[A-Za-z0-9_-]{5,20}|(?:QQ|qq)\s*(?:号)?\s*[:：]?\s*\d{5,12}|(?:电话|手机号|联系方式)\s*[:：]?\s*(?<!\d)1?[3-9]?\d{4,11}(?!\d)/g },
];

/** 统一脱敏函数。规则命中即替换为固定掩码；对已掩码文本重复处理结果不变。 */
export function redactText(text: string): string {
  let out = text;
  for (const rule of RULES) out = out.replace(rule.re, MASK);
  return out;
}

export function containsContact(text: string): boolean {
  return RULES.some((rule) => {
    rule.re.lastIndex = 0;
    return rule.re.test(text);
  });
}
