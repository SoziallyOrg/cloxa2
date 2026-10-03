import { t } from "@cloxa/i18n";

import { NotFoundView } from "@/components/ui/NotFoundView";

/** `notFound()` inside `/manage` (e.g. an unknown employee): shown within the frame. */
export default function ManageNotFound() {
  return <NotFoundView href="/manage" label={t("errors.notFoundManage")} />;
}
