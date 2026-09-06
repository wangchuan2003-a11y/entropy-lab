import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("forward and backward recover exact visible state and recorded path", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#left")).toHaveText("100");
  await expect(page.locator(".particle")).toHaveCount(100);
  await page.locator("#forward").click();
  const before = await page.locator("#event").innerText();
  const entropy = await page.locator("#entropy").innerText();
  const path = await page
    .locator("#entropy-plot .entropy-line")
    .getAttribute("d");
  await page.locator("#back").click();
  await expect(page.locator("#left")).toHaveText("100");
  await page.locator("#forward").click();
  await expect(page.locator("#event")).toHaveText(before);
  await expect(page.locator("#entropy")).toHaveText(entropy);
  expect(
    await page.locator("#entropy-plot .entropy-line").getAttribute("d"),
  ).toBe(path);
  await expect(page.locator("#samples")).toHaveText("2 个状态样本");
  expect(errors).toEqual([]);
});
test("play, pause, reset and keyboard inputs work on both viewports", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#n").fill("21");
  await page.locator("#n").press("Tab");
  await page.locator("#initial").selectOption("balanced");
  await expect(page.locator("#left")).toHaveText("10");
  await expect(page.locator("#right")).toHaveText("11");
  await page.locator("#play").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#play")).toHaveText("暂停");
  await expect
    .poll(async () => Number(await page.locator("#timeline").inputValue()))
    .toBeGreaterThan(1);
  await page.locator("#play").click();
  await page.locator("#replay").click();
  await expect(page.locator("#timeline")).toHaveValue("0");
  await expect(page.locator("#samples")).toHaveText("1 个状态样本");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
test("initial settings share and CSV contain current observed prefix", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw Error("denied");
        },
      },
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.locator("#initial").selectOption("balanced");
  await page.locator("#forward").click();
  await page.locator("#share").click();
  await expect(page.locator("#status")).toContainText("手动复制");
  expect(new URL(page.url()).hash).toBe("#v1.100.42.balanced");
  const event = page.waitForEvent("download");
  await page.locator("#csv").click();
  const download = await event;
  const path = info.outputPath("trajectory.csv");
  await download.saveAs(path);
  const csv = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  expect(csv.trim().split("\r\n")).toHaveLength(3);
  expect(csv).toContain("0,50,50,");
  await page.reload();
  await expect(page.locator("#left")).toHaveText("50");
  await expect(page.locator("#timeline")).toHaveValue("0");
});
