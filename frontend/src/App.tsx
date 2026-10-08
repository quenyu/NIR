import { lazy, Suspense } from "react";

const MainPage = lazy(() => import("./pages/MainPage").then(({ MainPage: Page }) => ({ default: Page })));
const ExperimentsPage = lazy(() => import("./pages/ExperimentsPage").then(({ ExperimentsPage: Page }) => ({ default: Page })));

export default function App() {
  const Page = window.location.pathname.startsWith("/experiments")
    ? ExperimentsPage
    : MainPage;
  return (
    <Suspense fallback={<div className="route-loading">Загрузка интерфейса…</div>}>
      <Page />
    </Suspense>
  );
}
