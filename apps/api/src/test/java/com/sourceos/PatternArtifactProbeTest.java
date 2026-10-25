package com.sourceos;

import static org.assertj.core.api.Assertions.*;

import com.sourceos.pattern.PatternArtifactProbe;
import com.sourceos.pattern.PatternArtifactProbe.Format;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;

class PatternArtifactProbeTest {
  byte[] bytes(String s) {
    return s.getBytes(StandardCharsets.ISO_8859_1);
  }

  @ParameterizedTest
  @ValueSource(strings = {"", " ", "\t", "\r", "\n", " \t\r\n"})
  void permittedPdfTail(String tail) {
    assertThatCode(() -> PatternArtifactProbe.inspect(Format.PDF, bytes("%PDF-1.4\n%%EOF" + tail)))
        .doesNotThrowAnyException();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"not-pdf%%EOF", "%PDF-1.4", "%PDF-%%EOFx", "%PDF-%%EOF\u000b", "%PDF-%%EOF\f"})
  void badPdf(String s) {
    assertThatThrownBy(() -> PatternArtifactProbe.inspect(Format.PDF, bytes(s)))
        .hasMessageContaining("400");
  }

  @ParameterizedTest
  @CsvSource({"DXF_AAMA,LF", "DXF_ASTM,CRLF", "DXF_AAMA,CR"})
  void textDxfAndNonUtf8Values(Format f, String ending) {
    String e = ending.equals("LF") ? "\n" : ending.equals("CRLF") ? "\r\n" : "\r";
    assertThatCode(
            () ->
                PatternArtifactProbe.inspect(
                    f,
                    bytes(
                        " 0\t"
                            + e
                            + " SECTION "
                            + e
                            + "1"
                            + e
                            + "\u00ff"
                            + e
                            + "0"
                            + e
                            + "EOF"
                            + e
                            + " \t\r\n")))
        .doesNotThrowAnyException();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "AutoCAD Binary DXF\r\n\u001a\u0000",
        "0\nSECTION\n0\nEOF\n\0",
        "0\nEOF",
        "0\nSECTION",
        "0\nSECTION\n1\nEOF",
        "0\nSECTION\n0\nEOF\n0\nCOMMENT",
        "0\nSECTION\n0\nEOF\ncomment",
        "0\nSECTION\n0\nEOF\n\f",
        "0\nSECTION\n0\nEOF\n\u000b",
        "0\nSECTION\n1",
        "bad\nSECTION\n0\nEOF",
        "1072\nx\n0\nSECTION\n0\nEOF",
        "\nSECTION\n0\nEOF",
        "-1\nx\n0\nSECTION\n0\nEOF"
      })
  void badDxf(String s) {
    assertThatThrownBy(() -> PatternArtifactProbe.inspect(Format.DXF_AAMA, bytes(s)))
        .hasMessageContaining("400");
  }

  @ParameterizedTest
  @ValueSource(ints = {8192, 8193})
  void exactLogicalLineBound(int n) {
    String d = "0\nSECTION\n1\n" + "x".repeat(n) + "\n0\nEOF";
    if (n == 8192)
      assertThatCode(() -> PatternArtifactProbe.inspect(Format.DXF_ASTM, bytes(d)))
          .doesNotThrowAnyException();
    else
      assertThatThrownBy(() -> PatternArtifactProbe.inspect(Format.DXF_ASTM, bytes(d)))
          .hasMessageContaining("400");
  }

  @ParameterizedTest
  @ValueSource(ints = {1000000, 1000001})
  void exactPairBound(int n) {
    var b = bytes("0\nSECTION\n" + "1\n\n".repeat(n - 2) + "0\nEOF\n");
    if (n == 1000000)
      assertThatCode(() -> PatternArtifactProbe.inspect(Format.DXF_AAMA, b))
          .doesNotThrowAnyException();
    else
      assertThatThrownBy(() -> PatternArtifactProbe.inspect(Format.DXF_AAMA, b))
          .hasMessageContaining("400");
  }

  @Test
  void pureStaticProbeHasNoInfrastructureFields() {
    assertThat(
            Arrays.stream(PatternArtifactProbe.class.getDeclaredFields())
                .map(f -> f.getType().getName())
                .toList())
        .containsOnly("int");
  }
}
