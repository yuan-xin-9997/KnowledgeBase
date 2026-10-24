import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import EmptyState from "../components/EmptyState";

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="这里还没有内容"
      description="你访问的页面不存在，或许是链接已经失效。"
      action={
        <Link to="/" className="btn btn-primary">
          回到总览
        </Link>
      }
    />
  );
}
