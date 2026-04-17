const puppeteer = require("puppeteer");

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.goto("file://" + __dirname + "/poster1.html", {
        waitUntil: "networkidle0",
    });

    await page.pdf({
        path: "output.pdf",
        width: "841mm",
        height: "1189mm",
        printBackground: true,
    });

    await browser.close();
})();