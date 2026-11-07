/**
 * Скриншоты и смоук-проверка запущенного сайта через установленный браузер (Edge/Chrome) — без скачивания Chromium.
 *
 *   npm run screenshot -- [url] [--out=shot.png] [--size=1440x900] [--browser=msedge|chrome] [--do=…]…
 *
 * Действия --do выполняются по порядку:
 *   wait:<мс>              пауза
 *   hover:<x>,<y>          навести мышь на точку окна
 *   click:<x>,<y>          клик по точке;  click:<css>  — клик по элементу
 *   dblclick:<x>,<y>       двойной клик
 *   wheel:<dy>             прокрутка колесом (зум карты) в текущей позиции мыши
 *   press:<клавиша>        нажатие клавиши (Escape, Slash, …)
 *   type:<текст>           ввод текста в элемент с фокусом
 *   goto:<hash>            сменить #-адрес (например goto:#/m/world/e/some-id)
 *   shot:<файл.png>        промежуточный скриншот
 * В конце — скриншот в --out. Ошибки консоли и страницы печатаются; код выхода 1, если они были.
 */
/// <reference lib="dom" />
import { chromium } from 'playwright-core';

interface Options {
  url: string;
  out: string;
  width: number;
  height: number;
  browser: string;
  actions: string[];
}

function parseArgs(argv: string[]): Options {
  const options: Options = { url: 'http://localhost:5173/', out: 'screenshot.png', width: 1440, height: 900, browser: 'msedge', actions: [] };
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (key === '--out') options.out = value;
    else if (key === '--size') {
      const [w, h] = value.split('x').map(Number);
      if (w && h) Object.assign(options, { width: w, height: h });
    } else if (key === '--browser') options.browser = value;
    else if (key === '--do') options.actions.push(value);
    else if (!arg.startsWith('--')) options.url = arg;
  }
  return options;
}

function point(spec: string): [number, number] {
  const [x, y] = spec.split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Ожидались координаты x,y: «${spec}»`);
  return [x!, y!];
}

const options = parseArgs(process.argv.slice(2));
const browser = await chromium.launch({ channel: options.browser, headless: true });
const page = await browser.newPage({ viewport: { width: options.width, height: options.height } });
const problems: string[] = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`[console.${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));
page.on('requestfailed', (request) => problems.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`));

try {
  await page.goto(options.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  for (const action of options.actions) {
    const [name, ...rest] = action.split(':');
    const arg = rest.join(':');
    switch (name) {
      case 'wait':
        await page.waitForTimeout(Number(arg) || 300);
        break;
      case 'hover':
        await page.mouse.move(...point(arg), { steps: 4 });
        break;
      case 'click':
        if (/^\d/.test(arg)) await page.mouse.click(...point(arg));
        else await page.click(arg);
        break;
      case 'dblclick':
        await page.mouse.dblclick(...point(arg));
        break;
      case 'wheel':
        await page.mouse.wheel(0, Number(arg));
        break;
      case 'press':
        await page.keyboard.press(arg);
        break;
      case 'type':
        await page.keyboard.type(arg, { delay: 20 });
        break;
      case 'goto':
        await page.evaluate((hash) => {
          window.location.hash = hash;
        }, arg);
        break;
      case 'shot':
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: arg });
        console.log(`снимок: ${arg}`);
        break;
      default:
        throw new Error(`Неизвестное действие «${name}»`);
    }
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: options.out });
  console.log(`снимок: ${options.out}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\nПроблемы (${problems.length}):\n${problems.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Ошибок в консоли нет.');
}
