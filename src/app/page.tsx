import Link from "next/link";

const whatsappUrl = `https://wa.me/77051586877?text=${encodeURIComponent(
  "Здравствуйте! Хочу узнать подробнее о занятиях по физике и математике.",
)}`;

const directions = [
  {
    number: "01",
    title: "Школьная программа",
    text: "Закрываем пробелы, разбираем сложные темы и формируем прочную базу без механического заучивания.",
    color: "mint",
    tag: "5–11 классы",
  },
  {
    number: "02",
    title: "Подготовка к экзаменам",
    text: "Системная подготовка к школьным и международным экзаменам с диагностикой и регулярным контролем результата.",
    color: "blue",
    tag: "Экзамены",
  },
  {
    number: "03",
    title: "Международные программы",
    text: "Физика и математика на русском и английском языках для IB, A-Level, IGCSE и других программ.",
    color: "yellow",
    tag: "IB · A-Level",
  },
  {
    number: "04",
    title: "Университетская программа",
    text: "Помощь с механикой, термодинамикой, электричеством, математическим анализом и другими университетскими дисциплинами.",
    color: "coral",
    tag: "Университет",
  },
];

const approach = [
  ["Индивидуальные занятия", "Полноценные уроки один на один с разбором теории и задач."],
  ["Домашняя работа с проверкой", "Ученик получает задания, комментарии и разбор ошибок."],
  ["Персональный план и сопровождение", "Программа строится под текущий уровень, цель и срок подготовки."],
  ["Тесты и тренажёры на платформе", "Материалы, задания, результаты и прогресс сохраняются в личном кабинете."],
];

function ArrowIcon() {
  return <span aria-hidden="true">↗</span>;
}

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="NSP — на главную">
          <span className="brand-mark">N</span>
          <span>NSP</span>
        </a>
        <nav className="desktop-nav" aria-label="Основная навигация">
          <a href="#directions">Программы</a>
          <a href="#approach">Как проходят занятия</a>
          <a href="#teacher">Преподаватель</a>
        </nav>
        <div className="header-buttons">
          <Link className="login-link" href="/login">Войти</Link>
          <a className="header-action" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Записаться</a>
        </div>
      </header>

      <section className="hero section-shell" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span /> Индивидуальные онлайн-занятия</div>
          <h1>Физика и<br /><em>математика.</em></h1>
          <p className="hero-lead">
            Персональные занятия с преподавателем и личная учебная платформа — всё необходимое для понятного и измеримого прогресса.
          </p>
          <div className="hero-actions">
            <a className="button button-dark" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Записаться <ArrowIcon /></a>
            <Link className="button hero-login-button" href="/login">Войти</Link>
          </div>
          <div className="hero-proof stats-row">
            <p><strong>7+ лет</strong><br />преподавания</p>
            <p><strong>200+</strong><br />учеников</p>
            <p><strong>1 на 1</strong><br />индивидуальный подход</p>
          </div>
        </div>

        <div className="lesson-card dashboard-card" id="cabinet" aria-label="Интерфейс личного кабинета ученика">
          <div className="dashboard-header">
            <div><span className="dashboard-kicker">Личный кабинет</span><h2>Добрый день, Алихан!</h2></div>
            <span className="profile-dot">А</span>
          </div>
          <div className="next-lesson">
            <div className="lesson-date"><strong>24</strong><span>сент</span></div>
            <div><span>Следующее занятие</span><h3>Механика: законы Ньютона</h3><p>Сегодня · 17:00–18:00</p></div>
            <span className="video-button" aria-hidden="true">→</span>
          </div>
          <div className="dashboard-grid">
            <article className="progress-widget">
              <span>Прогресс курса</span>
              <div className="progress-circle"><strong>68%</strong></div>
              <p>Физика · Механика</p>
            </article>
            <article className="homework-widget">
              <span>Домашнее задание</span>
              <h3>Законы Ньютона</h3>
              <p>8 из 10 заданий выполнено</p>
              <div className="progress homework-progress"><span /></div>
            </article>
          </div>
          <div className="test-widget">
            <div><span>Последний тест</span><h3>Механика</h3></div>
            <div className="test-score"><strong>9/10</strong><span>отличный результат</span></div>
          </div>
          <div className="floating-badge"><span>↑</span> прогресс за месяц</div>
        </div>
      </section>

      <section className="marquee" aria-label="Направления обучения">
        <span>Физика</span><i>✦</i><span>Математика</span><i>✦</i><span>Экзамены</span><i>✦</i><span>Международные программы</span><i>✦</i><span>Школьная программа</span>
      </section>

      <section className="courses section-shell" id="directions">
        <div className="section-heading">
          <div><span className="section-number">01</span><p>Направления обучения</p></div>
          <h2>Программа под вашу<br />учебную цель</h2>
          <p>Занятия выстраиваются вокруг уровня, программы и результата конкретного ученика.</p>
        </div>
        <div className="course-grid">
          {directions.map((direction) => (
            <article className={`course-card ${direction.color}`} key={direction.title}>
              <div className="course-top"><span>{direction.number}</span><span>{direction.tag}</span></div>
              <div className="course-visual" aria-hidden="true">
                <span className="orb orb-one" /><span className="orb orb-two" /><span className="orb orb-three" />
              </div>
              <h3>{direction.title}</h3>
              <p>{direction.text}</p>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" aria-label={`Записаться: ${direction.title}`}>Записаться <ArrowIcon /></a>
            </article>
          ))}
        </div>
      </section>

      <section className="method" id="approach">
        <div className="section-shell method-inner">
          <div className="method-intro">
            <span className="section-number light">02</span>
            <p className="method-label">Индивидуальный подход</p>
            <h2>Занятия, собранные<br />вокруг ученика</h2>
            <p>Индивидуальные уроки, проверка домашних заданий и персональный план дополняются инструментами собственной учебной платформы.</p>
          </div>
          <ol className="step-list">
            {approach.map(([title, text], index) => (
              <li key={title}>
                <span className="step-index">0{index + 1}</span>
                <div><h3>{title}</h3><p>{text}</p></div>
                <span className="step-arrow" aria-hidden="true">→</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="teacher-section section-shell" id="teacher">
        <div className="teacher-copy">
          <span className="section-number">03</span>
          <p className="method-label teacher-label">Преподаватель</p>
          <h2>Арман <em>Бисембаев</em></h2>
          <h3>Преподаватель физики и математики</h3>
          <p>Преподаватель физики и математики с опытом более 7 лет. Работаю со школьниками, абитуриентами и студентами университетов. Помогаю выстроить прочную базу, подготовиться к экзаменам и разобраться со сложными темами без механического заучивания.</p>
          <p className="teacher-directions">Направления: школьная программа, международные программы, экзамены, олимпиадная подготовка и университетская физика.</p>
          <div className="teacher-facts"><span><strong>7+</strong> лет опыта</span><span><strong>200+</strong> учеников</span></div>
        </div>
      </section>

      <footer className="footer section-shell">
        <a className="brand" href="#top"><span className="brand-mark">N</span><span>NSP</span></a>
        <p>Физика и математика.</p>
        <div><a href="#directions">Программы</a><a href="#teacher">Преподаватель</a><a href="mailto:hello@nsp.ru">Связаться</a></div>
        <span>© 2026 NSP</span>
      </footer>
    </main>
  );
}
