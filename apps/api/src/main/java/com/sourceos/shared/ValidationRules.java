package com.sourceos.shared;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
public final class ValidationRules {
 private ValidationRules(){}
 public static void notes(String value){if(value!=null && value.matches("(?is).*(?:Bearer\\s+|github_pat_|gh[pousr]_|-----BEGIN|password\\s*[:=]|authorization\\s*:).*"))throw bad("Sensitive content is not permitted in notes");}
 public static void url(String value){if(value==null)return;try{var u=URI.create(value);if(value.length()>2000 || !("https".equals(u.getScheme()) || "http".equals(u.getScheme())) || u.getHost()==null || u.getUserInfo()!=null || u.getFragment()!=null)throw new IllegalArgumentException();}catch(IllegalArgumentException e){throw bad("Invalid HTTP URL");}}
 public static ResponseStatusException bad(String message){return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
 public static ResponseStatusException conflict(){return new ResponseStatusException(HttpStatus.CONFLICT,"Resource changed or identity conflicts; refresh and retry");}
 public static ResponseStatusException missing(){return new ResponseStatusException(HttpStatus.NOT_FOUND,"Resource not found");}
}
