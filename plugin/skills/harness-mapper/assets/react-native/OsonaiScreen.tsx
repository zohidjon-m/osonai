// Osonai chat screen. Added by the Osonai setup; the tools are in harness/bindings.ts.
import { OsonaiChat } from '@osonai/react-native';
import manifest from '__HARNESS__/manifest.json';
import design from '__HARNESS__/design.json';
import { tools } from '__HARNESS__/bindings';
import { OSONAI_APP_KEY, OSONAI_URL } from '__CONFIG__';

type Props = {
  /** What is on screen now, with the names of harness/manifest.json "context". */
  context?: Record<string, unknown>;
  onClose?: () => void;
  /** A tap on a chat card: open the app's screen of that kind for that item. */
  onOpen?: (kind: string, id: string) => void;
};

export function OsonaiScreen({ context, onClose, onOpen }: Props) {
  return (
    <OsonaiChat
      runtimeUrl={OSONAI_URL}
      appKey={OSONAI_APP_KEY}
      manifest={manifest}
      tools={tools}
      design={design}
      views
      context={context}
      title="__TITLE__"
      showClose={!!onClose}
      onClose={onClose}
      onOpen={onOpen}
    />
  );
}
