// The glossary's first entries (migration 2): Flowplan's core terms as the
// existing catalogues (flowplan/locales/fr.json, zh.json) render them, with
// the German term as a note. Reviewers maintain the glossary afterwards.
// Russian came later (migration 4, RU_TERMS below).
const TERMS: [term: string, de: string, fr: string, zh: string][] = [
  ["Workspace", "Arbeitsbereich", "Espace de travail", "工作区"],
  ["Database", "Datenbank", "Base de données", "数据库"],
  ["Whiteboard", "Whiteboard", "Tableau blanc", "白板"],
  ["Journal", "Tagebuch", "Journal", "日记"],
  ["Page", "Seite", "Page", "页面"],
  ["Block", "Block", "Bloc", "区块"],
  ["Template", "Vorlage", "Modèle", "模板"],
  ["Record", "Eintrag", "Enregistrement", "记录"],
  ["Space", "Bereich", "Espace", "空间"],
  ["Workflow", "Workflow", "Workflow", "工作流"],
  ["Task", "Aufgabe", "Tâche", "任务"],
  ["Inbox", "Eingang", "Boîte de réception", "收件箱"],
  ["Dashboard", "Dashboard", "Tableau de bord", "仪表板"],
  ["View", "Ansicht", "Vue", "视图"],
  ["Property", "Eigenschaft", "Propriété", "属性"],
  ["Look", "Erscheinungsbild", "Apparence", "外观"],
  ["Marketplace", "Marketplace", "Marketplace", "市场"],
  ["Member", "Mitglied", "Membre", "成员"],
  ["Calendar", "Kalender", "Calendrier", "日历"],
  ["Tag", "Tag", "Étiquette", "标签"],
];

export const GLOSSARY_SEED = TERMS.flatMap(([term, de, fr, zh]) => [
  { lang: "fr", term, translation: fr, note: `Deutsch: ${de}` },
  { lang: "zh", term, translation: zh, note: `Deutsch: ${de}` },
]);

// Russian (migration 4): the same core terms in the usual Russian UI
// wording (Microsoft/Apple/Google terminology where there is one).
const RU_TERMS: Record<string, string> = {
  Workspace: "Рабочее пространство",
  Database: "База данных",
  Whiteboard: "Доска",
  Journal: "Дневник",
  Page: "Страница",
  Block: "Блок",
  Template: "Шаблон",
  Record: "Запись",
  Space: "Раздел",
  Workflow: "Рабочий процесс",
  Task: "Задача",
  Inbox: "Входящие",
  Dashboard: "Панель мониторинга",
  View: "Представление",
  Property: "Свойство",
  Look: "Внешний вид",
  Marketplace: "Маркетплейс",
  Member: "Участник",
  Calendar: "Календарь",
  Tag: "Тег",
};

export const GLOSSARY_SEED_RU = TERMS.map(([term, de]) => ({ lang: "ru", term, translation: RU_TERMS[term], note: `Deutsch: ${de}` }));

export const LANGUAGE_NOTES_SEED_RU = [
  {
    lang: "ru",
    note:
      "Formal address everywhere: «вы» (lowercase, as Apple, Google and Microsoft write it in their interfaces), never «ты»; imperatives in the formal form (Нажмите, Выберите). Quotes « », no space before : ; ! ?. There are no plural rules in the code: with a number, prefer forms that fit any count (e.g. «Записей: {0}»).",
  },
];

export const LANGUAGE_NOTES_SEED = [
  {
    lang: "fr",
    note: "Use « vous » everywhere (the maintainer's rule), never « tu ».",
  },
  { lang: "zh", note: "Simplified Chinese (zh-Hans / zh-CN). Full-width punctuation (，。：？！)." },
];
