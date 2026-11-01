<%@ page session="false" trimDirectiveWhitespaces="true" %><%
String destination = "https://node27006-kittakat.ktm.yetiappcloud.com" + request.getRequestURI();
String query = request.getQueryString();
if (query != null && !query.isEmpty()) destination += "?" + query;
response.setStatus(302);
response.setHeader("Location", destination);
response.setHeader("Cache-Control", "no-store");
%>
