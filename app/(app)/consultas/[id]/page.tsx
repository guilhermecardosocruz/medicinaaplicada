import ConsultClient from "./ConsultClient";

export default async function ConsultPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <ConsultClient sessionId={id} />;
}
