import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto('http://localhost:8000')

        # wait a bit for it to start
        await page.wait_for_timeout(2000)

        # take a few screenshots
        for i in range(5):
            await page.screenshot(path=f'/home/jules/verification/frame_{i}.png')
            await page.wait_for_timeout(1000)

        await browser.close()

asyncio.run(main())
