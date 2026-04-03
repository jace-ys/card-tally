import type { ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { StatementsPage } from "./pages/StatementsPage";
import { OrganizerPage } from "./pages/OrganizerPage";
import { RulesPage } from "./pages/RulesPage";
import { ArchivePage } from "./pages/ArchivePage";

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="title-wrap">
          <p className="eyebrow">Credit Card Statement Tallier</p>
          <h1>Card Tally</h1>
        </div>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            🧾 Statements
          </NavLink>
          <NavLink
            to="/organizer"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            ⚡ Organizer
          </NavLink>
          <NavLink
            to="/rules"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            🧠 Rules
          </NavLink>
          <NavLink
            to="/archive"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            🗂️ Archive
          </NavLink>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Layout>
            <StatementsPage />
          </Layout>
        }
      />
      <Route
        path="/organizer"
        element={
          <Layout>
            <OrganizerPage />
          </Layout>
        }
      />
      <Route
        path="/rules"
        element={
          <Layout>
            <RulesPage />
          </Layout>
        }
      />
      <Route
        path="/archive"
        element={
          <Layout>
            <ArchivePage />
          </Layout>
        }
      />
    </Routes>
  );
}
