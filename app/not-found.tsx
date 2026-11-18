import NextLink from "next/link.js";
import type { ComponentProps, ComponentType } from "react";
import { Bot } from "lucide-react";

const Link = NextLink as unknown as ComponentType<ComponentProps<"a">>;

export default function NotFound() {
  return <main className="container page">
    <article className="card empty-state not-found-card">
      <span className="tile"><Bot size={20}/></span>
      <h1>Страница не найдена</h1>
      <p>Возможно, ссылка устарела или у вас нет доступа к этому разделу.</p>
      <Link className="btn" href="/dashboard">Вернуться в панель</Link>
    </article>
  </main>;
}
