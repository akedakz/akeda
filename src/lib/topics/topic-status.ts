import type{StudentTopic,TopicStatus}from "@/components/students/student-topic-types";
export function topicStatuses(topics:StudentTopic[]){const current=topics.findIndex(topic=>!topic.completedAt);return new Map(topics.map((topic,index)=>[topic.id,(topic.completedAt?"COMPLETED":index===current?"IN_PROGRESS":"WAITING") as TopicStatus]));}
export const topicStatusLabels:Record<TopicStatus,string>={COMPLETED:"Завершена",IN_PROGRESS:"Текущая",WAITING:"Ожидает"};
