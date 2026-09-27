export const DEFAULT_QUESTIONS = [
  { question: 'ดาวเคราะห์ดวงใดอยู่ใกล้ดวงอาทิตย์ที่สุด?', options: ['โลก', 'ดาวพุธ', 'ดาวอังคาร', 'ดาวศุกร์'], answer: 1 },
  { question: '12 × 8 เท่ากับเท่าไร?', options: ['84', '88', '96', '108'], answer: 2 },
  { question: 'พืชใช้สิ่งใดสร้างอาหารในกระบวนการสังเคราะห์ด้วยแสง?', options: ['แสงอาทิตย์', 'เสียง', 'ลม', 'ความร้อนจากไฟ'], answer: 0 },
  { question: 'คำว่า “library” แปลว่าอะไร?', options: ['โรงพยาบาล', 'ห้องสมุด', 'โรงเรียน', 'สนามกีฬา'], answer: 1 },
  { question: 'น้ำเดือดที่ระดับน้ำทะเลเมื่อมีอุณหภูมิประมาณเท่าไร?', options: ['0°C', '50°C', '100°C', '150°C'], answer: 2 },
  { question: 'สามเหลี่ยมมีมุมภายในรวมกันกี่องศา?', options: ['90°', '180°', '270°', '360°'], answer: 1 },
  { question: 'ข้อใดเป็นพลังงานหมุนเวียน?', options: ['ถ่านหิน', 'น้ำมัน', 'พลังงานแสงอาทิตย์', 'ก๊าซธรรมชาติ'], answer: 2 },
  { question: 'อวัยวะใดทำหน้าที่สูบฉีดเลือด?', options: ['ปอด', 'ตับ', 'หัวใจ', 'กระเพาะอาหาร'], answer: 2 },
];

export const MAX_QUESTIONS = 20;

export function normalizeQuestions(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_QUESTIONS) throw new Error(`ต้องมีคำถาม 1–${MAX_QUESTIONS} ข้อ`);
  return input.map((item, index) => {
    const question = String(item?.question ?? '').trim();
    const options = item?.options;
    const answer = Number(item?.answer);
    if (!question || question.length > 120 || !Array.isArray(options) || options.length !== 4 ||
        options.some(option => typeof option !== 'string' || !option.trim() || option.trim().length > 80) ||
        !Number.isInteger(answer) || answer < 0 || answer > 3) {
      throw new Error(`ข้อ ${index + 1}: กรอกคำถาม ตัวเลือก 4 ข้อ และเฉลยให้ครบ`);
    }
    return { question, options: options.map(option => option.trim()), answer };
  });
}
