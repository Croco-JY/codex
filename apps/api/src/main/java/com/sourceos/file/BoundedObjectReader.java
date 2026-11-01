package com.sourceos.file;

import com.sourceos.authorization.ReleaseAuthorization.Binding;
import java.io.IOException;

/** File-private capability consumer, never a generic public storage route. */
interface BoundedObjectReader {
  byte[] readBounded(Binding binding) throws IOException;
}
