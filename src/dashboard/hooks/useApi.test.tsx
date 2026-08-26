import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useApi } from "./useApi";

afterEach(cleanup);

function Probe({ path, refreshKey }: { path: string; refreshKey?: number }) {
  const { data, loading, error } = useApi<{ value: string }>(path, refreshKey);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="data">{data?.value ?? "none"}</span>
      <span data-testid="error">{error ?? "none"}</span>
    </div>
  );
}

function mockFetch(responder: (path: string) => Promise<unknown>): void {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const body = await responder(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("useApi", () => {
  it("loads, then exposes the data", async () => {
    mockFetch(async () => ({ value: "first" }));
    render(<Probe path="/api/a" />);

    expect(screen.getByTestId("loading").textContent).toBe("true");
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("first"));
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("never shows the previous path's data under the new path", async () => {
    // The regression: switching project/branch/range kept the old response on
    // screen, with loading false, so the numbers looked like they belonged to
    // the new filter.
    let resolveSecond: ((value: unknown) => void) | null = null;
    mockFetch((path) =>
      path.endsWith("/a")
        ? Promise.resolve({ value: "first" })
        : new Promise((resolve) => {
            resolveSecond = resolve;
          })
    );

    const { rerender } = render(<Probe path="/api/a" />);
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("first"));

    rerender(<Probe path="/api/b" />);

    // Second request still in flight: no data, and loading is honest about it.
    expect(screen.getByTestId("data").textContent).toBe("none");
    expect(screen.getByTestId("loading").textContent).toBe("true");

    resolveSecond!({ value: "second" });
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("second"));
  });

  it("surfaces a failed request as an error", async () => {
    globalThis.fetch = mock(async () => new Response("nope", { status: 500, statusText: "Server Error" })) as unknown as typeof fetch;
    render(<Probe path="/api/broken" />);

    await waitFor(() => expect(screen.getByTestId("error").textContent).toContain("500"));
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(screen.getByTestId("data").textContent).toBe("none");
  });

  it("re-fetches when the refresh key changes", async () => {
    let calls = 0;
    mockFetch(async () => ({ value: `call-${++calls}` }));

    const { rerender } = render(<Probe path="/api/a" refreshKey={1} />);
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("call-1"));

    rerender(<Probe path="/api/a" refreshKey={2} />);
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("call-2"));
  });

  it("does not fetch at all for an empty path", async () => {
    const fetchSpy = mock(async () => new Response("{}"));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<Probe path="" />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });
});
