// Сумма прописью (рубли). Для нерублёвых валют — число + код.
const ONES = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

function tripleToWords(n: number, feminine: boolean): string {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) out.push(HUNDREDS[h]);
  if (t === 1) {
    out.push(TEENS[o]);
  } else {
    if (t) out.push(TENS[t]);
    if (o) out.push((feminine ? ONES_F : ONES)[o]);
  }
  return out.join(" ");
}

function plural(n: number, forms: [string, string, string]): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
}

/** Сумма прописью из минорных единиц (копеек). */
export function rublesInWords(amountMinor: number, currency = "RUB"): string {
  const abs = Math.abs(amountMinor);
  if (currency !== "RUB") return `${(abs / 100).toFixed(2)} ${currency}`;

  const sign = amountMinor < 0 ? "минус " : "";
  const rub = Math.floor(abs / 100);
  const kop = abs % 100;

  const parts: string[] = [];
  const millions = Math.floor(rub / 1_000_000);
  const thousands = Math.floor((rub % 1_000_000) / 1000);
  const units = rub % 1000;
  if (millions) parts.push(tripleToWords(millions, false) + " " + plural(millions, ["миллион", "миллиона", "миллионов"]));
  if (thousands) parts.push(tripleToWords(thousands, true) + " " + plural(thousands, ["тысяча", "тысячи", "тысяч"]));
  if (units || (!millions && !thousands)) parts.push(tripleToWords(units, false));

  let words = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!words) words = "ноль";
  words = words.charAt(0).toUpperCase() + words.slice(1);

  const rubWord = plural(rub, ["рубль", "рубля", "рублей"]);
  const kopWord = plural(kop, ["копейка", "копейки", "копеек"]);
  return `${sign}${words} ${rubWord} ${String(kop).padStart(2, "0")} ${kopWord}`;
}
