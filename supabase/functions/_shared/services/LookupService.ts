// New comment or incoming SMS recalculates the lookup cache
// references: ["+123456789+1098766541"], while lookup backend expects "+123456789" (without the phone number of Outlier team)
const refreshLookupCache = async (conversationId: string, references: string[]) => {
  const ref = references[0].replace(Deno.env.get('OUTLIER_PHONE_NUMBER')!, '')
  const url = `${Deno.env.get('LOOKUP_URL')!}/refresh-summary/${conversationId}?reference=${ref}`

  try {
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${Deno.env.get('LOOKUP_SECRET')!}`,
      },
    })
    if (!response.ok) {
      console.error(`Failed to refreshLookupCache. conversationId: ${conversationId}`)
    }
  } catch (error) {
    console.error(`refreshLookupCache error: ${error}, `)
  }
}

export default { refreshLookupCache }
