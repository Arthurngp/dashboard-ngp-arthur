'use client';

import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type NodeProps,
  type EdgeProps,
  getBezierPath,
  BaseEdge,
  EdgeLabelRenderer,
  type Connection,
  type Edge,
  type Node,
  type EdgeChange,
  type OnConnect,
  MarkerType,
  ReactFlowProvider,
} from 'reactflow';

import { useState, useEffect, useCallback } from 'react'
import type { NGPForm, FormField, FieldType, FieldLogicRule } from '@/types/trackeamento'
import * as Storage from '@/lib/trackeamento/storage'

/* ── Constants ── */
const TYPE_LABELS: Partial<Record<FieldType, string>> = {
  short_text: 'Texto curto', long_text: 'Texto longo', email: 'E-mail', phone: 'Telefone',
  number: 'Número', url: 'URL', multiple_choice: 'Múltipla escolha', checkbox: 'Checkbox',
  dropdown: 'Dropdown', yes_no: 'Sim / Não', rating: 'Avaliação', opinion_scale: 'Escala',
  date: 'Data', file_upload: 'Upload', welcome: 'Boas-vindas', statement: 'Texto',
  thank_you: 'Obrigado', picture_choice: 'Imagem',
};

const LOGIC_COLORS = ['#6C5CE7', '#00B894', '#E17055', '#0984E3', '#E84393', '#FDCB6E'];
const LOGIC_CAPABLE: FieldType[] = ['yes_no', 'multiple_choice', 'dropdown'];
const SUBMIT_ID = '__submit__';

const ADD_TYPES: { type: FieldType; label: string }[] = [
  { type: 'short_text',      label: 'Texto curto' },
  { type: 'long_text',       label: 'Texto longo' },
  { type: 'multiple_choice', label: 'Múltipla escolha' },
  { type: 'yes_no',          label: 'Sim / Não' },
  { type: 'dropdown',        label: 'Dropdown' },
  { type: 'email',           label: 'E-mail' },
  { type: 'number',          label: 'Número' },
  { type: 'rating',          label: 'Avaliação' },
  { type: 'date',            label: 'Data' },
];

/* ─────────────────────────────────────────
   Custom Nodes
───────────────────────────────────────── */

type FieldNodeData = {
  field: FormField;
  index: number;
  hasLogic: boolean;
  onSelect: (id: string) => void;
};

function FieldNode({ data, selected }: NodeProps<FieldNodeData>) {
  const { field, index, hasLogic, onSelect } = data;
  const typeLabel = TYPE_LABELS[field.type] ?? field.type;
  const canLogic = LOGIC_CAPABLE.includes(field.type);

  return (
    <div
      onDoubleClick={() => onSelect(field.id)}
      title="Duplo clique para editar"
      style={{
        width: 240,
        background: '#1a1a2e',
        border: `1.5px solid ${selected ? '#6C5CE7' : hasLogic ? 'rgba(108,92,231,0.6)' : '#2d2d3d'}`,
        borderRadius: 10,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        userSelect: 'none',
        boxShadow: selected
          ? '0 0 0 3px rgba(108,92,231,0.3), 0 4px 16px rgba(0,0,0,0.4)'
          : hasLogic
          ? '0 0 0 3px rgba(108,92,231,0.1), 0 2px 8px rgba(0,0,0,0.3)'
          : '0 2px 8px rgba(0,0,0,0.3)',
      }}
    >
      {/* Number badge */}
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: '#0f0f1a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#666' }}>{index + 1}</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px',
          color: hasLogic ? '#6C5CE7' : '#555',
          marginBottom: 2,
        }}>
          {typeLabel}{hasLogic ? ' · lógica' : ''}
        </div>
        <div style={{
          fontSize: 13, fontWeight: 600,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: '#e0e0e0',
        }}>
          {field.title || '(sem título)'}
        </div>
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#6C5CE7', border: '2px solid #1a1a2e', width: 10, height: 10, top: -6 }}
      />
      <Handle
        type="source"
        id="seq"
        position={Position.Bottom}
        style={{ background: '#444', border: '2px solid #1a1a2e', width: 8, height: 8, bottom: -5 }}
      />
      {canLogic && (
        <Handle
          type="source"
          id="logic"
          position={Position.Right}
          title="Arraste para criar lógica condicional"
          style={{
            background: '#6C5CE7',
            border: '2px solid #1a1a2e',
            width: 12, height: 12,
            right: -7,
            boxShadow: '0 0 6px rgba(108,92,231,0.6)',
          }}
        />
      )}
    </div>
  );
}

function SubmitNode({ selected }: NodeProps) {
  return (
    <div style={{
      width: 240, height: 44,
      background: 'rgba(0,184,148,0.08)',
      border: `1.5px dashed ${selected ? '#00B894' : 'rgba(0,184,148,0.7)'}`,
      borderRadius: 10,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 8, color: '#00B894', fontSize: 13, fontWeight: 700,
      boxShadow: selected ? '0 0 0 3px rgba(0,184,148,0.2)' : undefined,
      userSelect: 'none',
    }}>
      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M2 7l4 4 6-7" />
      </svg>
      Enviar formulário
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#00B894', border: '2px solid #1a1a2e', width: 10, height: 10, top: -6 }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────
   Custom Logic Edge
───────────────────────────────────────── */

type LogicEdgeData = {
  condition: string;
  color: string;
  onDelete: (id: string) => void;
};

function LogicEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data, selected, markerEnd,
}: EdgeProps<LogicEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const condLabel = data?.condition === 'sim' ? 'Sim'
    : data?.condition === 'nao' ? 'Não'
    : (data?.condition ?? '');
  const color = data?.color ?? '#6C5CE7';

  return (
    <>
      {/* Invisible wider path for easier click target */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={20} />

      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: color, strokeWidth: 2, strokeDasharray: '6,3' }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            zIndex: 10,
          }}
          className="nodrag nopan"
        >
          <div style={{
            background: color,
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 10,
            letterSpacing: '0.5px',
            whiteSpace: 'nowrap',
            textTransform: 'uppercase',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}>
            {condLabel}
          </div>
          {selected && (
            <button
              onClick={() => data?.onDelete(id)}
              title="Remover regra"
              style={{
                background: '#E17055',
                border: 'none',
                borderRadius: '50%',
                width: 18, height: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
              }}
            >
              ×
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/* ─────────────────────────────────────────
   Condition Picker Modal
───────────────────────────────────────── */

function ConditionPicker({
  sourceField,
  targetLabel,
  onConfirm,
  onCancel,
}: {
  sourceField: FormField;
  targetLabel: string;
  onConfirm: (condition: string) => void;
  onCancel: () => void;
}) {
  const conditions: { value: string; label: string }[] =
    sourceField.type === 'yes_no'
      ? [{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }]
      : (sourceField.options ?? []).map(o => ({ value: o, label: o }));

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: '#1a1a2e',
        border: '1px solid #2d2d3d',
        borderRadius: 14,
        padding: 24,
        minWidth: 300,
        maxWidth: 360,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>
          Condição da lógica
        </div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
          Ir para <strong style={{ color: '#bbb' }}>{targetLabel}</strong> quando a resposta for:
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {conditions.length === 0 ? (
            <p style={{ fontSize: 12, color: '#666', textAlign: 'center', padding: '8px 0' }}>
              Adicione opções ao campo para criar regras.
            </p>
          ) : (
            conditions.map(c => (
              <button
                key={c.value}
                onClick={() => onConfirm(c.value)}
                style={{
                  background: '#0f0f1a',
                  border: '1px solid #2d2d3d',
                  borderRadius: 8,
                  padding: '10px 14px',
                  color: '#ccc',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s',
                }}
                onMouseOver={e => {
                  e.currentTarget.style.borderColor = '#6C5CE7';
                  e.currentTarget.style.background = 'rgba(108,92,231,0.08)';
                }}
                onMouseOut={e => {
                  e.currentTarget.style.borderColor = '#2d2d3d';
                  e.currentTarget.style.background = '#0f0f1a';
                }}
              >
                <span>{c.label}</span>
                <span style={{ color: '#6C5CE7', fontSize: 11 }}>→ aplicar</span>
              </button>
            ))
          )}
        </div>

        <button
          onClick={onCancel}
          style={{
            marginTop: 14,
            width: '100%',
            background: 'transparent',
            border: '1px solid #2d2d3d',
            borderRadius: 8,
            padding: '8px 14px',
            color: '#666',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   Static type registrations (outside component to stay stable)
───────────────────────────────────────── */
const NODE_TYPES = { field: FieldNode, submit: SubmitNode };
const EDGE_TYPES = { logic: LogicEdge };

/* ─────────────────────────────────────────
   Main FlowEditor
───────────────────────────────────────── */

interface PendingConnection {
  sourceId: string;
  targetId: string;
}

interface FlowEditorProps {
  form: NGPForm;
  updateField: (id: string, patch: Partial<FormField>) => void;
  addField: (type: FieldType) => void;
  onSelectField: (id: string) => void;
}

function FlowEditorInner({ form, updateField, addField, onSelectField }: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FieldNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  /* ── Delete a logic edge → removes the logic rule from the field ── */
  const deleteLogicEdge = useCallback((edgeId: string) => {
    // id format: logic::<fieldId>::<condition>
    const parts = edgeId.split('::');
    if (parts.length < 3) return;
    const [, fieldId, condition] = parts;
    const field = form.fields.find(f => f.id === fieldId);
    if (!field) return;
    updateField(fieldId, { logic: (field.logic ?? []).filter(r => r.condition !== condition) });
  }, [form.fields, updateField]);

  /* ── Sync nodes whenever fields change ── */
  useEffect(() => {
    setNodes(prev => {
      const posById: Record<string, { x: number; y: number }> = {};
      prev.forEach(n => { posById[n.id] = n.position; });

      const fieldNodes: Node[] = form.fields.map((field, idx) => ({
        id: field.id,
        type: 'field',
        position: posById[field.id] ?? { x: 300, y: 80 + idx * 130 },
        data: {
          field,
          index: idx,
          hasLogic: !!(field.logic && field.logic.length > 0),
          onSelect: onSelectField,
        },
      }));

      const submitNode: Node = {
        id: SUBMIT_ID,
        type: 'submit',
        position: posById[SUBMIT_ID] ?? { x: 300, y: 80 + form.fields.length * 130 },
        data: {},
      };

      return [...fieldNodes, submitNode];
    });
  }, [form.fields, onSelectField, setNodes]);

  /* ── Sync edges whenever fields change ── */
  useEffect(() => {
    let colorIdx = 0;
    const newEdges: Edge[] = [];

    form.fields.forEach((field, idx) => {
      // Sequential edge (gray, non-interactive)
      const nextId = form.fields[idx + 1]?.id ?? SUBMIT_ID;
      newEdges.push({
        id: `seq::${field.id}::${nextId}`,
        source: field.id,
        sourceHandle: 'seq',
        target: nextId,
        type: 'default',
        style: { stroke: 'rgba(255,255,255,0.14)', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(255,255,255,0.14)', width: 14, height: 14 },
        deletable: false,
        focusable: false,
        zIndex: 0,
      });

      // Logic (conditional) edges
      (field.logic ?? []).forEach(rule => {
        const color = LOGIC_COLORS[colorIdx % LOGIC_COLORS.length];
        colorIdx++;
        const targetId = rule.jumpToFieldId === 'submit' ? SUBMIT_ID : rule.jumpToFieldId;
        newEdges.push({
          id: `logic::${field.id}::${rule.condition}`,
          source: field.id,
          sourceHandle: 'logic',
          target: targetId,
          type: 'logic',
          data: { condition: rule.condition, color, onDelete: deleteLogicEdge },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          deletable: true,
          zIndex: 1,
        });
      });
    });

    setEdges(newEdges);
  }, [form.fields, deleteLogicEdge, setEdges]);

  /* ── Handle new connection drag ── */
  const onConnect: OnConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.sourceHandle !== 'logic') return; // only logic handle creates rules

    const sourceField = form.fields.find(f => f.id === connection.source);
    if (!sourceField || !LOGIC_CAPABLE.includes(sourceField.type)) return;

    setPending({ sourceId: connection.source, targetId: connection.target });
  }, [form.fields]);

  /* ── Confirm condition selection ── */
  const confirmCondition = useCallback((condition: string) => {
    if (!pending) return;
    const { sourceId, targetId } = pending;
    const field = form.fields.find(f => f.id === sourceId);
    if (!field) return;
    const updated: FieldLogicRule[] = [
      ...(field.logic ?? []).filter(r => r.condition !== condition),
      { condition, jumpToFieldId: targetId === SUBMIT_ID ? 'submit' : targetId },
    ];
    updateField(sourceId, { logic: updated });
    setPending(null);
  }, [pending, form.fields, updateField]);

  /* ── Intercept edge changes to handle deletion properly ── */
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const passThrough: EdgeChange[] = [];
    for (const c of changes) {
      if (c.type === 'remove') {
        if (c.id.startsWith('logic::')) {
          deleteLogicEdge(c.id); // update form state; useEffect will rebuild edges
        }
        // don't pass removes — useEffect rebuilds from form state
      } else {
        passThrough.push(c);
      }
    }
    if (passThrough.length > 0) onEdgesChange(passThrough);
  }, [onEdgesChange, deleteLogicEdge]);

  /* ── Resolve labels for condition modal ── */
  const pendingSourceField = pending ? form.fields.find(f => f.id === pending.sourceId) ?? null : null;
  const pendingTargetLabel = pending
    ? (pending.targetId === SUBMIT_ID
      ? 'Enviar formulário'
      : form.fields.find(f => f.id === pending.targetId)?.title || '(sem título)')
    : '';

  return (
    <div style={{ flex: 1, height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        deleteKeyCode="Delete"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'default' }}
        style={{ background: '#0f0f1a' }}
      >
        <Background color="rgba(255,255,255,0.04)" gap={24} />
        <Controls
          style={{
            background: '#1a1a2e',
            border: '1px solid #2d2d3d',
            borderRadius: 8,
          }}
          showInteractive={false}
        />
      </ReactFlow>

      {/* ── Add field floating button ── */}
      <div style={{
        position: 'absolute', bottom: 20, left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
      }}>
        {showAddMenu && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 8px)',
            left: '50%', transform: 'translateX(-50%)',
            background: '#1a1a2e',
            border: '1px solid #2d2d3d',
            borderRadius: 12,
            padding: 10,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 4,
            minWidth: 240,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(8px)',
          }}>
            <div style={{
              gridColumn: '1 / -1',
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '1px', color: '#555',
              padding: '2px 6px 6px',
            }}>
              Tipo do campo
            </div>
            {ADD_TYPES.map(opt => (
              <button
                key={opt.type}
                onClick={() => { addField(opt.type); setShowAddMenu(false); }}
                style={{
                  background: '#0f0f1a',
                  border: '1px solid #2d2d3d',
                  borderRadius: 7,
                  padding: '8px 10px',
                  color: '#bbb',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.12s',
                  whiteSpace: 'nowrap',
                }}
                onMouseOver={e => {
                  e.currentTarget.style.borderColor = '#6C5CE7';
                  e.currentTarget.style.color = '#e0e0e0';
                }}
                onMouseOut={e => {
                  e.currentTarget.style.borderColor = '#2d2d3d';
                  e.currentTarget.style.color = '#bbb';
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setShowAddMenu(v => !v)}
          style={{
            background: '#6C5CE7',
            border: 'none',
            borderRadius: 24,
            padding: '10px 22px',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            boxShadow: '0 4px 20px rgba(108,92,231,0.45)',
            transition: 'all 0.15s',
          }}
          onMouseOver={e => (e.currentTarget.style.background = '#5A4BD1')}
          onMouseOut={e => (e.currentTarget.style.background = '#6C5CE7')}
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="6" y1="1" x2="6" y2="11" />
            <line x1="1" y1="6" x2="11" y2="6" />
          </svg>
          Adicionar pergunta
        </button>
      </div>

      {/* ── Hint tooltip ── */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        background: 'rgba(26,26,46,0.92)',
        border: '1px solid #2d2d3d',
        borderRadius: 8, padding: '6px 12px',
        fontSize: 11, color: '#666',
        backdropFilter: 'blur(8px)',
        pointerEvents: 'none',
        lineHeight: 1.5,
      }}>
        <span style={{ color: '#6C5CE7', fontWeight: 700 }}>●</span> handle direito → lógica condicional
        &nbsp;·&nbsp;
        duplo clique → editar
        &nbsp;·&nbsp;
        <kbd style={{ background: '#0f0f1a', border: '1px solid #333', borderRadius: 3, padding: '1px 4px', fontSize: 10 }}>Del</kbd> → apagar aresta
      </div>

      {/* ── Condition picker modal ── */}
      {pending && pendingSourceField && (
        <ConditionPicker
          sourceField={pendingSourceField}
          targetLabel={pendingTargetLabel}
          onConfirm={confirmCondition}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
