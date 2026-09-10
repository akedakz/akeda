import styles from "./development-feature-page.module.css";

type Props = { variant: "trainers" | "assistant"; icon: string; title: string; description: string; features: string[]; note: string };

export default function DevelopmentFeaturePage({ variant, icon, title, description, features, note }: Props) {
  return <div className={`${styles.page} ${styles[variant]}`}>
    <header><span>Новый раздел</span><h1>{title}</h1></header>
    <section className={styles.hero}>
      <div className={styles.visual} aria-hidden><i>{icon}</i><span/><span/><span/></div>
      <div className={styles.content}><b className={styles.badge}>В разработке</b><h2>{title}</h2><p>{description}</p><div className={styles.features}>{features.map((feature, index) => <article key={feature}><span>{index + 1}</span><strong>{feature}</strong></article>)}</div><small>{note}</small></div>
    </section>
  </div>;
}
