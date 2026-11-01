package com.sourceos.file;

import com.sourceos.authorization.ReleaseAuthorization.Binding;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.*;
import java.util.*;

/** Anchored no-follow local IO. Unsupported secure directory handles fail closed. */
final class SecureBoundedObjects {
  private SecureBoundedObjects() {}

  static byte[] read(Path root, Binding binding) throws IOException {
    if (binding == null) throw new IOException("Missing release binding");
    var c = binding.candidate();
    if (c.bytes() < 1
        || c.bytes() > AuthorizedStorage.MAX_BYTES
        || c.sha256() == null
        || !c.sha256().matches("[0-9a-f]{64}")) throw new IOException("Invalid release binding");
    Path absolute = root.toAbsolutePath().normalize();
    var handles = new ArrayList<DirectoryStream<Path>>();
    try {
      DirectoryStream<Path> first = Files.newDirectoryStream(absolute.getRoot());
      handles.add(first);
      if (!(first instanceof SecureDirectoryStream<Path> current))
        throw new IOException("Secure storage opening unavailable");
      for (Path segment : absolute) {
        var next = current.newDirectoryStream(segment, LinkOption.NOFOLLOW_LINKS);
        handles.add(next);
        current = next;
      }
      var organization =
          current.newDirectoryStream(Path.of(c.source().toString()), LinkOption.NOFOLLOW_LINKS);
      handles.add(organization);
      Path object = Path.of(c.object().toString());
      var attributes =
          organization
              .getFileAttributeView(object, BasicFileAttributeView.class, LinkOption.NOFOLLOW_LINKS)
              .readAttributes();
      if (!attributes.isRegularFile()) throw new IOException("Invalid storage object");
      int expected = Math.toIntExact(c.bytes());
      byte[] bounded = new byte[Math.addExact(expected, 1)];
      var buffer = ByteBuffer.wrap(bounded);
      try (var channel =
          organization.newByteChannel(
              object, Set.of(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS))) {
        while (buffer.hasRemaining()) {
          int n = channel.read(buffer);
          if (n < 0) break;
          if (n == 0) throw new IOException("Storage made no progress");
        }
      }
      if (buffer.position() != expected) throw new IOException("Stored content length mismatch");
      byte[] bytes = Arrays.copyOf(bounded, expected);
      String actual;
      try {
        actual = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
      } catch (NoSuchAlgorithmException unavailable) {
        throw new IOException("Integrity algorithm unavailable", unavailable);
      }
      if (!MessageDigest.isEqual(
          actual.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
          c.sha256().getBytes(java.nio.charset.StandardCharsets.US_ASCII)))
        throw new IOException("Stored content integrity mismatch");
      return bytes;
    } finally {
      IOException failed = null;
      for (int i = handles.size() - 1; i >= 0; i--)
        try {
          handles.get(i).close();
        } catch (IOException e) {
          failed = e;
        }
      if (failed != null) throw failed;
    }
  }
}
