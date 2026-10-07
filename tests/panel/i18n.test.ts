import { expect, test } from "bun:test";
import { errorCopy, resolveLocale, strings } from "../../panel/i18n";

test("selects a supported locale and falls back to English", () => {
  expect(resolveLocale("zh-CN")).toBe("zh");
  expect(resolveLocale("zh-TW")).toBe("zh");
  expect(resolveLocale("fr-FR")).toBe("fr");
  expect(resolveLocale("en-US")).toBe("en");
  expect(resolveLocale("de-DE")).toBe("en");
  expect(strings("fr").failedTitle).toBe("Échec de la requête mémoire");
  expect(strings("fr").emptyListTitle).toBe("Aucune mémoire pour le moment");
  expect(Object.keys(strings("fr")).sort()).toEqual(Object.keys(strings("en")).sort());
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
  expect(errorCopy(zh, "UPSTREAM_AUTH_UNAVAILABLE")).toEqual({
    title: zh.authTokenUnavailableTitle,
    body: zh.authTokenUnavailableBody,
  });
  expect(errorCopy(zh, "SERVICE_FAILED")).toEqual({
    title: zh.failedTitle,
    body: zh.failedBody,
  });
});
