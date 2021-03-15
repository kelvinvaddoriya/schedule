package com.example.schedule

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import kotlinx.android.synthetic.main.card_view_data.view.*

class DataAdapter(private val arrayList: ArrayList<DataStu>, val context: Context) :
        RecyclerView.Adapter<DataAdapter.ViewHolder>()
{
    class ViewHolder(itemView : View) : RecyclerView.ViewHolder(itemView)
    {
        fun bindItems(dataStu: DataStu)
        {
            itemView.card_heading.text = dataStu.Heading
            itemView.card_address.text = dataStu.Address
            itemView.card_time.text = dataStu.Time
            itemView.card_name.text = dataStu.Name
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val v= LayoutInflater.from(parent.context).inflate(R.layout.card_view_data,parent,false)
        return ViewHolder(v)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bindItems(arrayList[position])
    }

    override fun getItemCount(): Int {
        return arrayList.size
    }
}