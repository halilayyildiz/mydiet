// A tiny router: real URLs (/, /entry?date=…, /weight, /profile, /login, /register) with history.pushState.
import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

type Location = { path: string; query: URLSearchParams; href: string };
type Router = Location & { navigate: (href: string, opts?: { replace?: boolean }) => void };

const read = (): Location => ({ path: location.pathname, query: new URLSearchParams(location.search), href: location.pathname + location.search });

const RouterContext = createContext<Router | null>(null);

export function useRouterState(): Router {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const onPop = () => setLoc(read());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const navigate = (href: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) history.replaceState(null, "", href);
    else history.pushState(null, "", href);
    setLoc(read());
    if (!opts.replace) scrollTo(0, 0);
  };
  return { ...loc, navigate };
}

export const RouterProvider = RouterContext.Provider;

export function useRouter(): Router {
  return useContext(RouterContext)!;
}

/** An <a> that changes page without reloading (ctrl/cmd-click still opens a new tab). */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { navigate } = useRouter();
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={click} {...rest} />;
}
