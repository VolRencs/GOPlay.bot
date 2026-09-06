import "./globals.css"; import type { Metadata } from "next";
export const metadata:Metadata={
  title:"GOPlay",
  description:"Панель управления Discord-ботом GOPlay",
};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>}
