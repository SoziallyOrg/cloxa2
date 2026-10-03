import { t } from "@cloxa/i18n";

import { NotFoundView } from "@/components/ui/NotFoundView";

/** `notFound()` inside `/app`: shown within the app frame. */
export default function EmployeeNotFound() {
  return <NotFoundView href="/app" label={t("errors.notFoundApp")} />;
}
