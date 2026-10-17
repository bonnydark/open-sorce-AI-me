const json = (data, status = 200) => Response.json(data, { status });
const monthStart = () => { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0,0,0,0); return d.toISOString(); };

async function getMembership(db, userId) {
  return db.prepare(`SELECT m.owner_user_id AS ownerId,m.member_user_id AS memberId,m.invited_email AS invitedEmail,
      o.email AS ownerEmail,o.display_name AS ownerName,o.plan AS ownerPlan
    FROM business_team_memberships m JOIN users o ON o.id=m.owner_user_id
    WHERE m.member_user_id=? AND m.status='active' LIMIT 1`).bind(userId).first();
}
async function teamPayload(db, ownerId, viewerId) {
  const owner = await db.prepare(`SELECT u.id,u.email,u.display_name AS name,u.plan,u.token_balance AS tokens,
      (SELECT COUNT(*) FROM usage_events e WHERE e.user_id=u.id AND e.created_at>=strftime('%Y-%m-01T00:00:00.000Z','now')) AS requests,
      (SELECT COALESCE(SUM(e.image_count),0) FROM usage_events e WHERE e.user_id=u.id AND e.created_at>=strftime('%Y-%m-01T00:00:00.000Z','now')) AS images,
      (SELECT COALESCE(SUM(e.estimated_cost_usd),0) FROM usage_events e WHERE e.user_id=u.id AND e.created_at>=strftime('%Y-%m-01T00:00:00.000Z','now')) AS estimatedCostUsd,
      (SELECT COUNT(e.estimated_cost_usd) FROM usage_events e WHERE e.user_id=u.id AND e.created_at>=strftime('%Y-%m-01T00:00:00.000Z','now')) AS pricedRequests
    FROM users u WHERE u.id=?`).bind(ownerId).first();
  if (!owner || owner.plan !== "business") return null;
  const start = monthStart();
  const members = await db.prepare(`SELECT u.id,u.email,u.display_name AS name,m.created_at AS addedAt,
      (SELECT COUNT(*) FROM usage_events e WHERE e.user_id=u.id AND e.created_at>=?) AS requests,
      (SELECT COALESCE(SUM(e.image_count),0) FROM usage_events e WHERE e.user_id=u.id AND e.created_at>=?) AS images,
      (SELECT COALESCE(SUM(e.estimated_cost_usd),0) FROM usage_events e WHERE e.user_id=u.id AND e.created_at>=?) AS estimatedCostUsd,
      (SELECT COUNT(e.estimated_cost_usd) FROM usage_events e WHERE e.user_id=u.id AND e.created_at>=?) AS pricedRequests
    FROM business_team_memberships m JOIN users u ON u.id=m.member_user_id
    WHERE m.owner_user_id=? AND m.status='active' ORDER BY m.created_at ASC`).bind(start,start,start,start,ownerId).all();
  const allIds = [ownerId,...(members.results||[]).map(m=>m.id)];
  const total = await db.prepare(`SELECT COUNT(*) AS requests,COALESCE(SUM(image_count),0) AS images,
      COALESCE(SUM(estimated_cost_usd),0) AS estimatedCostUsd,COUNT(estimated_cost_usd) AS pricedRequests
    FROM usage_events WHERE created_at>=? AND user_id IN (${allIds.map(()=>"?").join(",")})`).bind(start,...allIds).first();
  return {
    role: viewerId===ownerId ? "business(main)" : "business(add)",
    owner: { id:owner.id,email:owner.email,name:owner.name,plan:owner.plan },
    members: viewerId===ownerId ? (members.results||[]) : (members.results||[]).filter(member=>member.id===viewerId),
    totals: { requests:Number(total?.requests||0),images:Number(total?.images||0),estimatedCostUsd:Number(total?.estimatedCostUsd||0),pricedRequests:Number(total?.pricedRequests||0),limit:20000,remaining:Math.max(0,20000-Number(total?.requests||0)) },
    periodStart:start
  };
}

export async function handleBusinessTeam(request, env, user, url) {
  if (!env.DB) return json({error:"Database is not configured."},503);
  const path=url.pathname;
  const owner=await env.DB.prepare("SELECT id,email,plan FROM users WHERE id=?").bind(user.id).first();
  const membership=await getMembership(env.DB,user.id);
  if(path==="/api/business/team" && request.method==="GET") {
    if(owner?.plan==="business") {
      const data=await teamPayload(env.DB,user.id,user.id);
      return json({ok:true,...data,canManage:true});
    }
    if(membership) {
      const data=await teamPayload(env.DB,membership.ownerId,user.id);
      if(data) return json({ok:true,...data,canManage:false});
    }
    return json({ok:true,role:"none",owner:null,members:[],totals:null,canManage:false});
  }
  if(path==="/api/business/team/invite" && request.method==="POST") {
    if(owner?.plan!=="business") return json({error:"Only the main account with an active Business plan can add team members."},403);
    let body; try{body=await request.json()}catch{return json({error:"Expected JSON."},400)}
    const email=typeof body?.email==="string"?body.email.trim().toLowerCase():"";
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254) return json({error:"Enter a valid account email."},400);
    if(email===String(user.email).toLowerCase()) return json({error:"The main account cannot be added as its own member."},400);
    const member=await env.DB.prepare("SELECT id,email,plan,stripe_subscription_status FROM users WHERE email=? COLLATE NOCASE").bind(email).first();
    if(!member) return json({error:"No account exists for this email yet. Ask them to register first, then add their email again."},404);
    const currentOwner=await getMembership(env.DB,member.id);
    if(currentOwner) return json({error:"This account already belongs to a Business team. Remove it from that team before adding it here."},409);
    if(member.plan==="business") return json({error:"An account with its own Business plan cannot be added as a secondary member."},409);
    if(member.plan==="pro" && ["active","trialing"].includes(member.stripe_subscription_status)) return json({error:"This account has an active Pro subscription. They must cancel or finish that subscription before joining a shared Business team to avoid duplicate billing."},409);
    try {
      await env.DB.prepare("INSERT INTO business_team_memberships (id,owner_user_id,member_user_id,invited_email,status) VALUES (?,?,?,?,'active')")
        .bind(crypto.randomUUID(),user.id,member.id,email).run();
      return json({ok:true,message:"Team member added. Their AI requests now use the shared Business allowance.",member:{id:member.id,email:member.email,name:member.display_name}});
    } catch(error) {
      if(/unique|constraint/i.test(String(error?.message||error))) return json({error:"This account is already on a Business team."},409);
      return json({error:"Could not add team member. Confirm migration 0011_business_teams.sql is applied."},503);
    }
  }
  const remove=path.match(/^\/api\/business\/team\/members\/([a-f0-9-]+)$/i);
  if(remove && request.method==="DELETE") {
    if(owner?.plan!=="business") return json({error:"Only the main Business account can remove members."},403);
    const result=await env.DB.prepare("DELETE FROM business_team_memberships WHERE owner_user_id=? AND member_user_id=? AND status='active'").bind(user.id,remove[1]).run();
    if(!Number(result?.meta?.changes||0)) return json({error:"Active team member not found."},404);
    return json({ok:true});
  }
  return json({error:"Not found."},404);
}
