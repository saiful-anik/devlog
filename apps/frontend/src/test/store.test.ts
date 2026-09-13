import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
  apiUrl: (path: string) => `https://api.example.test${path}`,
}));

import { resolveImageSrc } from "@/lib/store";

describe("resolveImageSrc", () => {
  it("uses the configured API origin for uploaded screenshot URLs", () => {
    expect(resolveImageSrc("/api/assets/user%2Fproject%2Fscreenshot"))
      .toBe("https://api.example.test/api/assets/user%2Fproject%2Fscreenshot");
  });

  it("preserves data and external image URLs", () => {
    expect(resolveImageSrc("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
    expect(resolveImageSrc("https://images.example.test/screenshot.png")).toBe("https://images.example.test/screenshot.png");
  });
});
