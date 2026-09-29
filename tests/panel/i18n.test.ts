import { expect, test } from "bun:test";
import { errorCopy, resolveLocale, strings } from "../../panel/i18n";

test("selects Chinese for zh locales and English otherwise", () => {
  expect(resolveLocale("zh-CN")).toBe("zh");
  expect(resolveLocale("zh-TW")).toBe("zh");
  expect(resolveLocale("en-US")).toBe("en");
  expect(resolveLocale("fr-FR")).toBe("en");
});

test("maps error codes to contract-specific copy and falls back to generic failure", () => {
  const zh = strings("zh");
  expect(errorCopy(zh, "NO_SERVICE")).toEqual({
    title: zh.serviceNotApprovedTitle,
    body: zh.serviceNotApprovedBody,
  });
  expect(errorCopy(zh, "NOT_GRANTED")).toEqual({
    title: zh.serviceNotApprovedTitle,
    body: zh.serviceNotApprovedBody,
  });
  expect(errorCopy(zh, "UPSTREAM_UNAUTHORIZED")).toEqual({
    title: zh.unauthorizedTitle,
    body: zh.unauthorizedBody,
  });
  expect(errorCopy(zh, "UPSTREAM_UNAVAILABLE")).toEqual({
    title: zh.unavailableTitle,
    body: zh.unavailableBody,
  });
  expect(errorCopy(zh, "SERVICE_FAILED")).toEqual({
    title: zh.failedTitle,
    body: zh.failedBody,
  });
});
