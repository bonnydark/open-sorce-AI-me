const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, max-age=300" } });
async function getJson(url) {
 const response = await fetch(url,{headers:{"Accept":"application/json","User-Agent":"OpenSourceAI-Me-SecurityCenter/1.0"},signal:AbortSignal.timeout(9000),redirect:"error"});
 if(!response.ok)throw new Error("Public feed returned HTTP "+response.status);
 return response.json();
}
function clean(value,limit=500){return String(value||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,limit)}
export async function handleSecurity(request,url){
 if(request.method!=="GET")return json({error:"Method not allowed."},405);
 const query=clean(url.searchParams.get("q"),100);
 if(query.length<2)return json({error:"Enter at least 2 characters for a product or CVE search."},400);
 const encoded=encodeURIComponent(query);
 const jobs=await Promise.allSettled([
  getJson("https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch="+encoded+"&resultsPerPage=12"),
  getJson("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json")
 ]);
 const nvd=jobs[0].status==="fulfilled"?jobs[0].value:null;
 const kev=jobs[1].status==="fulfilled"?jobs[1].value:null;
 if(!nvd&&!kev)return json({error:"Both NVD and CISA public feeds are unavailable. Try again later."},502);
 const known=new Map();
 for(const item of (kev?.vulnerabilities||[])){
  const hay=(String(item.cveID||"")+" "+String(item.vendorProject||"")+" "+String(item.product||"")+" "+String(item.shortDescription||"")).toLowerCase();
  if(hay.includes(query.toLowerCase())||String(item.cveID||"").toLowerCase()===query.toLowerCase())known.set(item.cveID,item);
 }
 const cves=(nvd?.vulnerabilities||[]).map(entry=>{
  const cve=entry.cve||{},id=clean(cve.id,40),description=clean((cve.descriptions||[]).find(d=>d.lang==="en")?.value||(cve.descriptions||[])[0]?.value,650),metrics=cve.metrics||{};
  const cvss=metrics.cvssMetricV40?.[0]?.cvssData||metrics.cvssMetricV31?.[0]?.cvssData||metrics.cvssMetricV30?.[0]?.cvssData||metrics.cvssMetricV2?.[0]?.cvssData;
  const kevItem=(kev?.vulnerabilities||[]).find(item=>item.cveID===id);
  return {id,description,severity:clean(cvss?.baseSeverity||(cvss?.baseScore!=null?"CVSS "+cvss.baseScore:""),40)||"Severity unknown",published:cve.published||null,modified:cve.lastModified||null,url:id?"https://nvd.nist.gov/vuln/detail/"+encodeURIComponent(id):null,knownExploited:Boolean(kevItem),vendor:clean(kevItem?.vendorProject,100),product:clean(kevItem?.product,120),dateAdded:kevItem?.dateAdded||null,remediation:clean(kevItem?.requiredAction,300)};
 });
 const seen=new Set(cves.map(c=>c.id));
 for(const item of known.values())if(!seen.has(item.cveID)&&cves.length<20)cves.push({id:clean(item.cveID,40),description:clean(item.shortDescription,650),severity:"CISA Known Exploited",published:null,modified:null,url:"https://nvd.nist.gov/vuln/detail/"+encodeURIComponent(item.cveID),knownExploited:true,vendor:clean(item.vendorProject,100),product:clean(item.product,120),dateAdded:item.dateAdded||null,remediation:clean(item.requiredAction,300)});
 cves.sort((a,b)=>Number(b.knownExploited)-Number(a.knownExploited));
 return json({query,checkedAt:new Date().toISOString(),sources:{nvd:Boolean(nvd),cisaKev:Boolean(kev)},knownExploitedCount:cves.filter(c=>c.knownExploited).length,cves:cves.slice(0,15),disclaimer:"Published vulnerability intelligence only. A CVE may not be a zero-day; confirm affected versions and mitigations with the vendor."});
}