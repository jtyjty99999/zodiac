import CandidateInbox, {
  type CandidateCheckItem,
  type CandidateInboxItem,
} from "@/components/CandidateInbox";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { listCandidateChecks, listCandidates } from "@/lib/db/repositories/candidates";
import { listModules } from "@/lib/db/repositories/catalog";
import { listHarnesses } from "@/lib/db/repositories/harnesses";

export const metadata = { title: "新功能候选" };

const MAX_CANDIDATES = 200;

export default function CandidatesPage() {
  const db = getDb();
  const harnesses = listHarnesses(db);
  const modules = listModules(db);
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));

  const candidates = listCandidates(db).slice(0, MAX_CANDIDATES);
  const candidateItems: CandidateInboxItem[] = candidates.map((candidate) => ({
    id: candidate.id,
    harnessId: candidate.harnessId,
    harnessName: harnessById.get(candidate.harnessId)?.name ?? `Harness #${candidate.harnessId}`,
    name: candidate.name,
    description: candidate.description,
    evidence: candidate.evidence,
    confidence: candidate.confidence,
    moduleKey: candidate.moduleKey,
    createdDay: candidate.createdDay,
    status: candidate.status,
    reviewedDay: candidate.reviewedDay,
    commitId: candidate.commitId,
  }));

  const checks: CandidateCheckItem[] = candidates.flatMap((candidate) =>
    listCandidateChecks(db, candidate.id).map((check) => ({
      candidateId: candidate.id,
      harnessId: check.harnessId,
      harnessName: harnessById.get(check.harnessId)?.name ?? `Harness #${check.harnessId}`,
      status: check.status,
      evidence: check.evidence,
      note: check.note,
    })),
  );

  return (
    <div>
      <PageHeader
        title="新功能候选"
        description="从 feature 类提交中自动提炼的新功能点，附其他 harness 的交叉检查结果。确认后并入功能目录，并生成带日期的基线版本。"
      />
      <CandidateInbox
        candidates={candidateItems}
        checks={checks}
        harnesses={harnesses.map((harness) => ({ id: harness.id, name: harness.name }))}
        modules={modules.map((module) => ({ key: module.key, name: module.name }))}
      />
    </div>
  );
}
