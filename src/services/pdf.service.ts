import puppeteer from 'puppeteer';
import ejs from 'ejs';
import path from 'path';

export class PdfService {
  /**
   * Render an EJS template to a PDF Buffer.
   *
   * Templates live in `src/views/pdf`. `tsc` does not copy `.ejs` files, so they have to
   * exist in `dist/src/views/pdf` at run time — see the `copy:views` script in
   * package.json, which the build runs. Without it, every PDF request throws
   * `ENOENT .../views/pdf/guest-folio.ejs` in production while working fine under ts-node.
   */
  private static async browser(): Promise<any> {
    return puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  private static async toPdf(html: string): Promise<Buffer> {
    const browser = await PdfService.browser();
    try {
      const page = await browser.newPage();

      // `domcontentloaded` first, then wait for the network to settle.
      //
      // `waitUntil: 'networkidle0'` is the obvious call and it is what this did, but the
      // installed puppeteer types reject the string — `setContent`'s `waitUntil` is typed as
      // the narrower `'load' | 'domcontentloaded'` here. The two-step form is equivalent in
      // effect and typed. `waitForNetworkIdle` has its own timeout, so a template that never
      // goes quiet (a slow external font) cannot hang the request forever.
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 });
      } catch {
        // Timed out waiting for idle. The markup is already there, so render it rather
        // than fail the whole PDF over one slow asset.
      }

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm'
        }
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  static async generatePdf(templateName: string, data: any): Promise<Buffer> {
    const templatePath = path.join(__dirname, '..', 'views', 'pdf', `${templateName}.ejs`);
    const html = await ejs.renderFile(templatePath, data);
    return PdfService.toPdf(html);
  }

  /**
   * Render an already-assembled HTML document to a PDF Buffer.
   *
   * Preferred over `generatePdf` for the folio documents: the `src/views/pdf/*.ejs` set
   * carries unconverted PHP from the blade originals, so those templates cannot be
   * trusted to compile. Callers that build their markup in TypeScript come through here.
   */
  static async generateHtmlPdf(html: string): Promise<Buffer> {
    return PdfService.toPdf(html);
  }
}
