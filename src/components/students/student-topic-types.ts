export type StudentTopic={id:string;title:string;sortOrder:number;completedAt:string|null};
export type TopicStatus="COMPLETED"|"IN_PROGRESS"|"WAITING";
export type TopicActionResult={ok:boolean;message:string;topics?:StudentTopic[]};
export type TopicTemplateSummary={id:string;title:string;itemCount:number;updatedAt:string};
