import { afterEach, describe, expect, it } from "bun:test";
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ProjectProvider, RangeProvider, RefreshProvider, useProject, useRange, useRefresh } from "./App";

afterEach(cleanup);

const withRefresh = ({ children }: { children: ReactNode }) => <RefreshProvider>{children}</RefreshProvider>;
const withProject = ({ children }: { children: ReactNode }) => <ProjectProvider>{children}</ProjectProvider>;
const withRange = ({ children }: { children: ReactNode }) => <RangeProvider>{children}</RangeProvider>;

describe("context providers", () => {
  it("hand out a stable value across re-renders that change nothing", () => {
    // A fresh object literal as the context value re-renders every consumer on
    // every render of the provider — and the provider wraps the whole tree.
    const { result, rerender } = renderHook(() => useRefresh(), { wrapper: withRefresh });

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("bumps the refresh key when refresh is called", () => {
    const { result } = renderHook(() => useRefresh(), { wrapper: withRefresh });

    const before = result.current.refreshKey;
    act(() => result.current.refresh());
    expect(result.current.refreshKey).toBe(before + 1);
  });

  it("keeps `refresh` itself stable while the key moves", () => {
    const { result } = renderHook(() => useRefresh(), { wrapper: withRefresh });

    const refresh = result.current.refresh;
    act(() => result.current.refresh());
    expect(result.current.refresh).toBe(refresh);
  });

  it("clears the branch when the project changes", () => {
    // A branch only means something inside the project it belongs to.
    const { result } = renderHook(() => useProject(), { wrapper: withProject });

    act(() => result.current.setProject("/repo-a"));
    act(() => result.current.setBranch("feature"));
    expect(result.current.branch).toBe("feature");

    act(() => result.current.setProject("/repo-b"));
    expect(result.current.project).toBe("/repo-b");
    expect(result.current.branch).toBeNull();
  });

  it("defaults the range to seven days and updates it", () => {
    const { result } = renderHook(() => useRange(), { wrapper: withRange });

    expect(result.current.days).toBe(7);
    act(() => result.current.setDays(30));
    expect(result.current.days).toBe(30);
  });

  it("throws when useRefresh is used with no provider above it", () => {
    expect(() => renderHook(() => useRefresh())).toThrow("useRefresh must be used within a RefreshProvider");
  });
});
