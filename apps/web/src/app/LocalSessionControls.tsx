import { useState } from "react";
import { setLocalSubject } from "../api/client";
import { Button, Input } from "../ui";
import { useSession } from "./session";
export default function LocalSessionControls() {
  const { local } = useSession();
  const [subject, setSubject] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!/^[A-Za-z0-9._@-]{1,255}$/.test(subject)) {
          setInvalid(true);
          return;
        }
        setLocalSubject(subject);
      }}
    >
      <label htmlFor="dev-subject">Local development identity</label>
      <Input
        id="dev-subject"
        value={subject}
        autoComplete="off"
        required
        maxLength={255}
        aria-invalid={invalid}
        aria-describedby={invalid ? "dev-subject-error" : undefined}
        onChange={(event) => {
          setSubject(event.target.value);
          setInvalid(false);
        }}
      />
      {invalid && (
        <p id="dev-subject-error" role="alert">
          Use letters, numbers, dots, underscores, @ or hyphens.
        </p>
      )}
      <Button type="submit">
        {local ? "Switch local identity" : "Use local identity"}
      </Button>
    </form>
  );
}
